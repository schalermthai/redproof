import { mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { counting, defineAdapter, defineRules, type Adapter, type NoUnknownKeys, type Rule } from 'redproof';
import { executeCommand } from 'redproof/command';
import { checkResult, evaluateExecution, finalOutcome, knipArguments, refusal, withinRoot,
  type KnipReport } from './core/decision.ts';
import { ruleDefinitions } from './core/model.ts';
import { validateKnipOptions, type KnipOptions, type Selection } from './core/options.ts';
import { knipPackageRootOf, requiredKnip, unsupportedVersion } from './core/version.ts';

type Catalog<M extends Selection> = { readonly [K in keyof M]: Rule<typeof ruleDefinitions[M[K]]['id']> };
export type { KnipOptions } from './core/options.ts';

async function confined(root: string, path: string): Promise<string> {
  const actual = await realpath(resolve(root, path));
  if (!withinRoot(root, actual)) throw new Error('Knip path resolves outside the Gate root.');
  return actual;
}

const readManifest = (packageRoot: string) => readFile(join(packageRoot, 'package.json'), 'utf8');

async function readReport(file: string, limit: number): Promise<KnipReport> {
  try {
    if ((await stat(file)).size > limit) throw new Error('Knip evidence exceeds maxOutputBytes.');
    return { kind: 'text', text: await readFile(file, 'utf8') };
  } catch (error) {
    return { kind: 'unavailable', error: String(error) };
  }
}

export function knip<const O extends KnipOptions>(options: O & NoUnknownKeys<O, KnipOptions>): Adapter<Catalog<O['rules']>> {
  validateKnipOptions(options);
  const entries = Object.entries(options.rules);
  const rules = defineRules(Object.fromEntries(entries.map(([alias, type]) => [alias, ruleDefinitions[type]])) as Catalog<O['rules']>);
  const selected = new Map(entries.map(([alias, type]) => [type, rules[alias as keyof O['rules']]! ]));
  const settings = { ...options };
  const limit = options.maxOutputBytes ?? 10 * 1024 * 1024;
  const reporter = fileURLToPath(new URL(import.meta.url.endsWith('.ts') ? './reporter.ts' : './reporter.js', import.meta.url));

  return defineAdapter({ kind: 'knip', rules, check: {
    description: 'run Knip and evaluate selected structured issue categories',
    counting: counting.supported,
    async run(ctx) {
      const startedAt = new Date().toISOString();
      let temp: string | undefined;
      const decision = await (async () => {
        try {
          const root = await realpath(ctx.root);
          const cwd = await confined(root, settings.cwd ?? '.');
          let cli: string;
          if (settings.cli) {
            cli = await confined(root, settings.cli);
            const packageRoot = knipPackageRootOf(cli);
            /** A wrapper script names no version, so only a real install can be judged. */
            const installed = packageRoot === undefined
              ? undefined
              : await readManifest(packageRoot).then(unsupportedVersion).catch(() => undefined);
            if (installed) return refusal('knip-version-unsupported', requiredKnip, installed);
          } else {
            const packageRoot = resolve(dirname(createRequire(join(cwd, 'package.json')).resolve('knip')), '..');
            const installed = unsupportedVersion(await readManifest(packageRoot));
            if (installed) return refusal('knip-version-unsupported', requiredKnip, installed);
            cli = join(packageRoot, 'bin/knip.js');
          }
          const configFile = settings.configFile ? await confined(root, settings.configFile) : undefined;
          temp = await mkdtemp(join(tmpdir(), 'redproof-knip-'));
          const reportFile = join(temp, 'evidence.json');
          const execution = await executeCommand({ command: process.execPath,
            args: knipArguments(settings, { cli, reporter, configFile }), cwd,
            timeoutMs: settings.timeoutMs ?? 60_000, maxOutputBytes: limit,
            env: { REDPROOF_KNIP_REPORT: reportFile, REDPROOF_KNIP_ROOT: root,
              REDPROOF_KNIP_LIMIT: String(limit) } });
          return evaluateExecution(execution, await readReport(reportFile, limit), selected);
        } catch (error) {
          return refusal('knip-unavailable', 'Knip could not complete the check.', String(error));
        }
      })();
      let cleanupError: string | undefined;
      if (temp) {
        try { await rm(temp, { recursive: true, force: true }); }
        catch (error) { cleanupError = String(error); }
      }
      return checkResult(finalOutcome(decision, cleanupError), { startedAt, finishedAt: new Date().toISOString() });
    },
  } });
}

export type { KnipIssueType } from './core/model.ts';
