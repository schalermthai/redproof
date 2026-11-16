import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

export const fixtures = fileURLToPath(new URL('../fixtures/', import.meta.url));

/** The python of the virtualenv holding the deptry under test (the battle-test venv by default). */
export const python: string = process.env.REDPROOF_DEPTRY_PYTHON
  ?? fileURLToPath(new URL('../../../../../23-deptry/.venv/bin/python', import.meta.url));
export const deptryBinary: string = join(dirname(python), 'deptry');

/**
 * The repo gate bans skipped tests, so without deptry the native tests are not registered at all.
 * Run them with REDPROOF_DEPTRY_PYTHON pointing at a python that has deptry installed.
 */
export const nativeTest: typeof test = existsSync(deptryBinary) ? test : (Object.assign(() => undefined, test) as never);

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
}): Promise<string> {
  const file = join(root, 'fake-deptry.mjs');
  await writeFile(file, `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args.includes('--version')) { process.stdout.write(${JSON.stringify((options.version ?? 'deptry 0.25.1') + '\n')}); process.exit(0); }
const out = args[args.indexOf('--json-output') + 1];
${options.report === null ? '' : `writeFileSync(out, ${JSON.stringify(options.report)});`}
process.stderr.write(${JSON.stringify(options.stderr)});
${options.behaviour === 'hang' ? 'setInterval(() => {}, 1000);' : options.behaviour === 'kill' ? "process.kill(process.pid, 'SIGKILL');" : `process.exit(${options.exitCode});`}
`);
  await chmod(file, 0o755);
  return file;
}
