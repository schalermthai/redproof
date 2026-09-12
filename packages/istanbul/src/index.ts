import { mkdtemp, lstat, open, realpath, rm, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { counting, defineAdapter, defineRules, rejectUnknownKeys, result,
  type Adapter, type NoUnknownKeys, type Rule, type RuleRefOfCatalog } from 'redproof';
import { executeCommand } from 'redproof/command';
import { coverageBreaches, coveragePath, metrics, parseCoverage,
  type CoverageCatalog, type CoverageRules, type Metric, type Threshold } from './model.ts';

export type CoverageContext = { readonly root: string; readonly cwd: string; readonly reportFile: string; readonly reportDirectory: string; readonly tempDirectory: string };
type CommonOptions<R extends CoverageRules> = {
  readonly rules: R;
  readonly cwd?: string;
  /** Gate-root-relative files which must be present in the report, even if unexecuted. */
  readonly expectedFiles?: readonly string[];
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly maxReportBytes?: number;
};
export type IstanbulOptions<R extends CoverageRules = CoverageRules> = CommonOptions<R> & {
  readonly command: string;
  /** Producer must write full Istanbul JSON to this run's private reportFile. */
  readonly args: (context: CoverageContext) => readonly string[];
};
export type NycOptions<R extends CoverageRules = CoverageRules> = CommonOptions<R> & {
  /** Test executable, not another nyc invocation. */
  readonly command: string;
  readonly args?: readonly string[];
  readonly configFile?: string;
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
  /** Include unexecuted files. Defaults to true. Native exclusions still apply. */
  readonly all?: boolean;
};
type ExactRules<R> = { readonly [K in keyof R]: NoUnknownKeys<R[K], Threshold> };
const commonKeys = ['rules', 'cwd', 'expectedFiles', 'timeoutMs', 'maxOutputBytes', 'maxReportBytes'] as const;
const ruleIds = { statements: 'istanbul/statements-coverage', branches: 'istanbul/branches-coverage',
  functions: 'istanbul/functions-coverage', lines: 'istanbul/lines-coverage' } as const;

function pathOption(name: string, path: unknown): asserts path is string {
  if (typeof path !== 'string' || !path.trim() || path.includes('\0') || isAbsolute(path)
    || /^[A-Za-z]:/u.test(path) || path.split(/[\\/]/u).includes('..')) throw new Error(`${name} must be a confined relative path.`);
}
function validate<R extends CoverageRules>(options: CommonOptions<R> & { command: string }): void {
  if (typeof options.command !== 'string' || !options.command.trim() || options.command.includes('\0')) throw new Error('Istanbul command must not be empty.');
  rejectUnknownKeys(options.rules, metrics, 'Istanbul rule');
  if (!Object.keys(options.rules).length) throw new Error('Istanbul requires at least one Redproof rule.');
  for (const threshold of Object.values(options.rules)) {
    if (!threshold || typeof threshold !== 'object' || Array.isArray(threshold)) throw new Error('Istanbul threshold must be an object.');
    rejectUnknownKeys(threshold, ['minimum', 'perFile'], 'Istanbul threshold');
    if (!Number.isFinite(threshold.minimum) || threshold.minimum < 0 || threshold.minimum > 100) throw new Error('minimum must be between 0 and 100.');
    if (threshold.perFile !== undefined && typeof threshold.perFile !== 'boolean') throw new Error('perFile must be boolean.');
  }
  if (options.cwd !== undefined) pathOption('cwd', options.cwd);
  if (options.expectedFiles !== undefined) {
    if (!Array.isArray(options.expectedFiles) || !options.expectedFiles.length) throw new Error('expectedFiles must be a non-empty array.');
    for (const file of options.expectedFiles) pathOption('expectedFiles', file);
    if (new Set(options.expectedFiles).size !== options.expectedFiles.length) throw new Error('expectedFiles must be unique.');
  }
  for (const key of ['timeoutMs', 'maxOutputBytes', 'maxReportBytes'] as const) {
    if (options[key] !== undefined && (!Number.isSafeInteger(options[key]) || options[key]! <= 0)) throw new Error(`${key} must be a positive integer.`);
  }
}

function adapter<R extends CoverageRules>(options: CommonOptions<R>, plan: (context: CoverageContext) => Promise<{ command: string; args: readonly string[] }>): Adapter<CoverageCatalog<R>> {
  const thresholds = Object.entries(options.rules).map(([name, threshold]) => [name as Metric, { ...threshold }] as const);
  const rules = defineRules(Object.fromEntries(thresholds.map(([metric, threshold]) => [metric, {
    id: ruleIds[metric], description: `${metric} coverage must be at least ${threshold.minimum}% ${threshold.perFile ? 'in each reported file' : 'overall'}.`,
  }])) as CoverageCatalog<R>);
  const selected = new Map(thresholds.map(([metric, threshold]) => [metric, {
    rule: (rules as Record<Metric, Rule<RuleRefOfCatalog<CoverageCatalog<R>>>>)[metric], threshold,
  }]));
  const cwdOption = options.cwd ?? '.', expectedFiles = [...(options.expectedFiles ?? [])];
  const timeoutMs = options.timeoutMs ?? 60_000, maxOutputBytes = options.maxOutputBytes ?? 10 * 1024 * 1024;
  const maxReportBytes = options.maxReportBytes ?? 20 * 1024 * 1024;
  return defineAdapter({ kind: 'istanbul', rules, check: {
    description: 'collect fresh Istanbul coverage and evaluate selected thresholds', counting: counting.supported,
    async run(ctx) {
      const startedAt = new Date().toISOString();
      const scan = (inspected: number | null) => ({ source: 'istanbul', startedAt, finishedAt: new Date().toISOString(), inspected });
      const refuse = (code: string, message: string, detail?: string) => result.refuse(scan(null), {
        code, message, location: null, ...(detail ? { detail } : {}),
      });
      let temp: string | undefined;
      try {
        const root = await realpath(ctx.root), cwd = await realpath(resolve(root, cwdOption));
        if (cwd !== root) coveragePath(root, cwd);
        const required = await Promise.all(expectedFiles.map(async file => coveragePath(root, await realpath(resolve(root, file)))));
        temp = await mkdtemp(join(tmpdir(), 'redproof-istanbul-'));
        const reportDirectory = temp, reportFile = join(temp, 'coverage-final.json');
        const command = await plan({ root, cwd, reportDirectory, reportFile, tempDirectory: join(temp, 'raw') });
        if (!Array.isArray(command.args) || command.args.some(arg => typeof arg !== 'string' || arg.includes('\0'))) throw new Error('Invalid coverage command arguments.');
        const execution = await executeCommand({ ...command, cwd, timeoutMs, maxOutputBytes,
          env: { NODE_TEST_CONTEXT: undefined, REDPROOF_COVERAGE_REPORT: reportFile } });
        if (execution.kind === 'refused') return refuse(execution.code, execution.message, execution.detail);
        // Coverage can be emitted even when tests or instrumentation fail. It cannot explain that failure.
        if (execution.exitCode !== 0) return refuse('istanbul-producer-unsuccessful', 'Coverage producer did not complete successfully.',
          `exit code: ${execution.exitCode}\n${execution.stderr}\n${execution.stdout}`);
        const stat = await lstat(reportFile);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > maxReportBytes) throw new Error('Coverage report must be a private bounded regular file.');
        const handle = await open(reportFile, constants.O_RDONLY | constants.O_NOFOLLOW);
        let text: string;
        try {
          const opened = await handle.stat();
          if (!opened.isFile() || opened.ino !== stat.ino || opened.dev !== stat.dev || opened.nlink !== 1) throw new Error('Coverage report identity changed.');
          const bytes = Buffer.alloc(stat.size + 1);
          let length = 0;
          while (length < bytes.length) {
            const read = await handle.read(bytes, length, bytes.length - length, null);
            if (!read.bytesRead) break;
            length += read.bytesRead;
          }
          if (length !== stat.size) throw new Error('Coverage report size changed while reading.');
          text = bytes.toString('utf8', 0, length);
        } finally { await handle.close(); }
        const evidence = parseCoverage(text, root);
        for (const file of evidence.files) {
          coveragePath(root, await realpath(resolve(root, file.file)));
        }
        const reported = new Set(evidence.files.map(file => file.file));
        const missing = required.filter(file => !reported.has(file));
        if (missing.length) return refuse('istanbul-incomplete-inventory', 'Expected source files are absent from coverage.', missing.join('\n'));
        return result.fromBreaches(scan(evidence.files.length), coverageBreaches(evidence, selected));
      } catch (error) {
        return refuse('istanbul-evidence-unavailable', 'Could not collect trustworthy Istanbul coverage.', error instanceof Error ? error.message : String(error));
      } finally {
        if (temp) {
          try { await rm(temp, { recursive: true, force: true }); }
          catch (error) { return refuse('istanbul-cleanup-unavailable', 'Could not clean up private coverage artifacts.', String(error)); }
        }
      }
    },
  } });
}

export function istanbul<const O extends IstanbulOptions>(options: O & NoUnknownKeys<O, IstanbulOptions> & { readonly rules: ExactRules<O['rules']> }): Adapter<CoverageCatalog<O['rules']>> {
  rejectUnknownKeys(options, [...commonKeys, 'command', 'args'], 'Istanbul adapter');
  validate(options);
  if (typeof options.args !== 'function') throw new Error('Istanbul args must be a report-context function.');
  const command = options.command, args = options.args;
  return adapter(options, async context => ({ command, args: args(context) }));
}

export function nyc<const O extends NycOptions>(options: O & NoUnknownKeys<O, NycOptions> & { readonly rules: ExactRules<O['rules']> }): Adapter<CoverageCatalog<O['rules']>> {
  rejectUnknownKeys(options, [...commonKeys, 'command', 'args', 'configFile', 'include', 'exclude', 'all'], 'nyc adapter');
  validate(options);
  if (options.configFile !== undefined) pathOption('configFile', options.configFile);
  if (options.all !== undefined && typeof options.all !== 'boolean') throw new Error('all must be boolean.');
  for (const key of ['args', 'include', 'exclude'] as const) {
    const values = options[key];
    if (values !== undefined && (!Array.isArray(values) || values.some(value => typeof value !== 'string' || value.includes('\0') || (key !== 'args' && !value.trim())))) throw new Error(`${key} must contain strings.`);
  }
  const command = options.command, args = [...(options.args ?? [])], all = options.all ?? true;
  const include = [...(options.include ?? [])], exclude = [...(options.exclude ?? [])], configFile = options.configFile;
  return adapter(options, async context => {
    const require = createRequire(join(context.cwd, 'package.json'));
    const manifestPath = require.resolve('nyc/package.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { version: string };
    if (!/^(15|16|17|18)\.\d+\.\d+$/u.test(manifest.version)) throw new Error(`Unsupported nyc version ${manifest.version}; expected >=15 <19.`);
    const config = configFile ? await realpath(resolve(context.root, configFile)) : undefined;
    if (config) coveragePath(context.root, config);
    return { command: process.execPath, args: [require.resolve('nyc/bin/nyc.js'),
      `--cwd=${context.cwd}`, ...(config ? [`--nycrc-path=${config}`] : []),
      ...include.map(pattern => `--include=${pattern}`), ...exclude.map(pattern => `--exclude=${pattern}`),
      '--reporter=json', `--report-dir=${context.reportDirectory}`, `--temp-dir=${context.tempDirectory}`,
      '--clean=true', '--cache=false', '--check-coverage=false', `--all=${all}`,
      '--', command, ...args] };
  });
}

export type { CoverageRules, CoverageCatalog, Threshold } from './model.ts';
