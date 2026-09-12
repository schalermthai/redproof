import { mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { counting, defineAdapter, defineRules, rejectUnknownKeys, result,
  type Adapter, type NoUnknownKeys, type Rule } from 'redproof';
import { executeCommand } from 'redproof/command';
import { issueTypes, knipBreaches, parseKnipEvidence, ruleDefinitions, type KnipIssueType } from './model.ts';

type Selection = Readonly<Record<string, KnipIssueType>>;
type Catalog<M extends Selection> = { readonly [K in keyof M]: Rule<typeof ruleDefinitions[M[K]]['id']> };
export type KnipOptions<M extends Selection = Selection> = {
  readonly rules: M;
  readonly cwd?: string;
  readonly configFile?: string;
  /** A Node CLI entry relative to the Gate root; defaults to the project's installed Knip. */
  readonly cli?: string;
  readonly workspace?: string;
  readonly production?: boolean;
  readonly strict?: boolean;
  readonly includeEntryExports?: boolean;
  readonly treatConfigHintsAsErrors?: boolean;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
};

function validatePath(name: string, value: string | undefined): void {
  if (value !== undefined && (typeof value !== 'string' || !value.trim()
    || isAbsolute(value) || /^[A-Za-z]:/u.test(value) || value.split(/[\\/]/u).includes('..'))) {
    throw new Error(`Knip ${name} must be a non-empty relative path inside the Gate root.`);
  }
}

async function confined(root: string, path: string): Promise<string> {
  const actual = await realpath(resolve(root, path));
  const rel = relative(root, actual);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new Error('Knip path resolves outside the Gate root.');
  }
  return actual;
}

export function knip<const O extends KnipOptions>(options: O & NoUnknownKeys<O, KnipOptions>): Adapter<Catalog<O['rules']>> {
  rejectUnknownKeys(options, ['rules', 'cwd', 'configFile', 'cli', 'workspace', 'production',
    'strict', 'includeEntryExports', 'treatConfigHintsAsErrors', 'timeoutMs', 'maxOutputBytes'], 'knip adapter');
  const entries = Object.entries(options.rules);
  if (!entries.length) throw new Error('Knip requires at least one Redproof rule.');
  for (const [alias, type] of entries) {
    if (!alias.trim() || !issueTypes.includes(type)) throw new Error(`Unknown Knip issue type: ${type}.`);
  }
  if (new Set(entries.map(([, type]) => type)).size !== entries.length) {
    throw new Error('Knip issue types must not be selected more than once.');
  }
  for (const name of ['cwd', 'configFile', 'cli'] as const) validatePath(name, options[name]);
  if (options.workspace !== undefined && (typeof options.workspace !== 'string'
    || !options.workspace.trim() || options.workspace.startsWith('-'))) {
    throw new Error('Knip workspace must be a non-empty selector, not an option.');
  }
  for (const name of ['production', 'strict', 'includeEntryExports', 'treatConfigHintsAsErrors'] as const) {
    if (options[name] !== undefined && typeof options[name] !== 'boolean') throw new Error(`Knip ${name} must be boolean.`);
  }
  for (const name of ['timeoutMs', 'maxOutputBytes'] as const) {
    const value = options[name];
    if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) throw new Error(`Knip ${name} must be a positive integer.`);
  }
  const rules = defineRules(Object.fromEntries(entries.map(([alias, type]) => [alias, ruleDefinitions[type]])) as Catalog<O['rules']>);
  const selected = new Map(entries.map(([alias, type]) => [type, rules[alias as keyof O['rules']]! ]));
  const settings = { ...options };
  const limit = options.maxOutputBytes ?? 10 * 1024 * 1024;

  return defineAdapter({ kind: 'knip', rules, check: {
    description: 'run Knip and evaluate selected structured issue categories',
    counting: counting.supported,
    async run(ctx) {
      const startedAt = new Date().toISOString();
      const scan = (inspected: number | null) => ({ source: 'knip', startedAt,
        finishedAt: new Date().toISOString(), inspected });
      const refuse = (code: string, message: string, detail?: string) => result.refuse(scan(null), {
        code, message, location: null, ...(detail ? { detail } : {}),
      });
      let temp: string | undefined;
      try {
        const root = await realpath(ctx.root);
        const cwd = await confined(root, settings.cwd ?? '.');
        let cli: string;
        if (settings.cli) cli = await confined(root, settings.cli);
        else {
          const packageRoot = resolve(dirname(createRequire(join(cwd, 'package.json')).resolve('knip')), '..');
          const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as { version?: string };
          const version = /^6\.(\d+)\.(\d+)$/u.exec(manifest.version ?? '');
          if (!version || Number(version[1]) < 35 || (Number(version[1]) === 35 && Number(version[2]) < 1)) {
            return refuse('knip-version-unsupported', 'This adapter requires Knip >=6.35.1 <7.', `Installed: ${manifest.version ?? 'unknown'}`);
          }
          cli = join(packageRoot, 'bin/knip.js');
        }
        const reporter = fileURLToPath(new URL(import.meta.url.endsWith('.ts') ? './reporter.ts' : './reporter.js', import.meta.url));
        temp = await mkdtemp(join(tmpdir(), 'redproof-knip-'));
        const reportFile = join(temp, 'evidence.json');
        const args = [cli, '--reporter', reporter, '--no-progress'];
        if (settings.configFile) args.push('--config', await confined(root, settings.configFile));
        if (settings.workspace) args.push(`--workspace=${settings.workspace}`);
        for (const [name, flag] of [
          ['production', '--production'], ['strict', '--strict'],
          ['includeEntryExports', '--include-entry-exports'],
          ['treatConfigHintsAsErrors', '--treat-config-hints-as-errors'],
        ] as const) if (settings[name]) args.push(flag);
        const execution = await executeCommand({ command: process.execPath, args, cwd,
          timeoutMs: settings.timeoutMs ?? 60_000, maxOutputBytes: limit,
          env: { REDPROOF_KNIP_REPORT: reportFile, REDPROOF_KNIP_ROOT: root,
            REDPROOF_KNIP_LIMIT: String(limit) } });
        if (execution.kind === 'refused') return refuse(execution.code, execution.message, execution.detail);
        const detail = [execution.stdout, execution.stderr].filter(Boolean).join('\n');
        if (execution.exitCode !== 0 && execution.exitCode !== 1) {
          return refuse('knip-unsuccessful', `Knip exited with code ${execution.exitCode}.`, detail);
        }
        let evidence;
        try {
          if ((await stat(reportFile)).size > limit) throw new Error('Knip evidence exceeds maxOutputBytes.');
          evidence = parseKnipEvidence(await readFile(reportFile, 'utf8'));
        } catch (error) {
          return refuse('knip-report-unavailable', 'Knip did not produce trustworthy evidence.',
            [String(error), detail].filter(Boolean).join('\n'));
        }
        if (evidence.hasConfigLoadErrors) return refuse('knip-config-unavailable', 'Knip could not load all tool configurations.', detail);
        if (evidence.hasBlockingHints) return refuse('knip-config-hints', 'Knip configuration or tag hints require attention.', evidence.hintDetails.join('\n'));
        const disabled = [...selected.keys()].filter(type => !evidence.enabled[type]);
        if (disabled.length) return refuse('knip-rule-inactive', 'Selected Knip categories were not inspected.', disabled.join(', '));
        if (execution.exitCode !== 0 && !evidence.findings.length) {
          return refuse('knip-unsuccessful', 'Knip exited unsuccessfully without structured issues explaining the exit.', detail);
        }
        return result.fromBreaches(scan(evidence.inspected), knipBreaches(evidence.findings, selected));
      } catch (error) {
        return refuse('knip-unavailable', 'Knip could not complete the check.', String(error));
      } finally {
        if (temp) {
          try { await rm(temp, { recursive: true, force: true }); }
          catch (error) { return refuse('knip-cleanup-unavailable', 'Could not remove temporary Knip evidence.', String(error)); }
        }
      }
    },
  } });
}

export type { KnipIssueType } from './model.ts';
