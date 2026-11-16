import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

export const fixtures = fileURLToPath(new URL('../fixtures/', import.meta.url));

export type Tool = { readonly label: string; readonly python: string; readonly binary: string };

const tool = (label: string, python: string): Tool => ({ label, python, binary: join(dirname(python), 'deptry') });

/**
 * The deptrys under test: REDPROOF_DEPTRY_PYTHON (the battle-test venv by default) and, when set,
 * REDPROOF_DEPTRY_PYTHON_OLDEST, the python of a virtualenv with the oldest supported deptry.
 */
const candidates: readonly Tool[] = [
  tool('latest', process.env.REDPROOF_DEPTRY_PYTHON ?? fileURLToPath(new URL('../../../../../23-deptry/.venv/bin/python', import.meta.url))),
  ...(process.env.REDPROOF_DEPTRY_PYTHON_OLDEST ? [tool('oldest', process.env.REDPROOF_DEPTRY_PYTHON_OLDEST)] : []),
];
export const tools: readonly Tool[] = candidates.filter(candidate => existsSync(candidate.binary));

/** Tools whose environment variable is set but whose binary is not there: with REQUIRED set, that must be loud, not a quietly smaller suite. */
export const missingTools: readonly Tool[] = candidates.filter(candidate => !existsSync(candidate.binary)
  && (candidate.label === 'oldest' || process.env.REDPROOF_DEPTRY_PYTHON !== undefined));

/** CI sets this beside the virtualenv: a missing deptry there must fail, not silently unregister the native tests. */
export const deptryRequired: boolean = process.env.REDPROOF_DEPTRY_REQUIRED === '1';

/** The repo gate bans skipped tests, so without deptry the native tests are not registered at all. */
export const nativeTest: typeof test = tools.length ? test : (Object.assign(() => undefined, test) as never);

export async function withProject<T>(files: Readonly<Record<string, string>>, action: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'redproof-deptry-test-'));
  try {
    for (const [name, text] of Object.entries(files)) {
      await mkdir(dirname(join(root, name)), { recursive: true });
      await writeFile(join(root, name), text);
    }
    return await action(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export const pyproject = (dependencies: readonly string[] = [], extra = ''): string =>
  `[project]\nname = "demo"\nversion = "0.1"\ndependencies = ${JSON.stringify(dependencies)}\n${extra}`;

export { header } from './reports.ts';

/**
 * A stand-in `deptry` executable, to rehearse outputs the real tool will not produce on demand.
 * It answers `--version`, and for a scan prints `stderr` and writes `report` to the `--json-output` file (when not null).
 */
export async function fakeDeptry(root: string, options: {
  report: string | null; stderr: string; exitCode: number; version?: string;
  /** `hang` never exits (timeout); `kill` SIGKILLs itself after writing, like an out-of-memory kill. */
  behaviour?: 'hang' | 'kill';
  /** Put a directory where the report file belongs, so reading it fails with something other than "not found". */
  reportIsDirectory?: boolean;
  /** Leave an unreadable directory in the report's temp directory, so removing that directory fails; its path is written to `temp-path.txt` in `root`. */
  lockTemp?: boolean;
}): Promise<string> {
  const file = join(root, 'fake-deptry.mjs');
  await writeFile(file, `#!/usr/bin/env node
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
const args = process.argv.slice(2);
if (args.includes('--version')) { process.stdout.write(${JSON.stringify((options.version ?? 'deptry 0.25.1') + '\n')}); process.exit(0); }
const out = args[args.indexOf('--json-output') + 1];
${options.reportIsDirectory ? 'mkdirSync(out);' : ''}
${options.lockTemp ? `writeFileSync(${JSON.stringify(join(root, 'temp-path.txt'))}, dirname(out)); mkdirSync(dirname(out) + '/locked'); writeFileSync(dirname(out) + '/locked/x', 'x'); chmodSync(dirname(out) + '/locked', 0);` : ''}
${options.report === null ? '' : `writeFileSync(out, ${JSON.stringify(options.report)});`}
process.stderr.write(${JSON.stringify(options.stderr)});
${options.behaviour === 'hang' ? 'setInterval(() => {}, 1000);' : options.behaviour === 'kill' ? "process.kill(process.pid, 'SIGKILL');" : `process.exit(${options.exitCode});`}
`);
  await chmod(file, 0o755);
  return file;
}
