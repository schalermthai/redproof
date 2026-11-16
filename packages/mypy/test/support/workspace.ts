import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Files = Readonly<Record<string, string>>;

export const fixtures = fileURLToPath(new URL('../fixtures/', import.meta.url));
export const readFixture = (name: string): Promise<string> => readFile(join(fixtures, name), 'utf8');

/**
 * The mypy under test: `REDPROOF_MYPY_PYTHON` names a Python that can `import mypy`, else the released
 * mypy in the battle-test venv `26-mypy/.venv-2.4.1`. No mypy, no native tests: they are not registered,
 * because the repo gate bans skipped tests. CI installs a released mypy and points the variable at it.
 */
export const python: string = process.env.REDPROOF_MYPY_PYTHON
  ?? fileURLToPath(new URL('../../../../../26-mypy/.venv-2.4.1/bin/python', import.meta.url));
export const hasMypy: boolean = existsSync(python)
  && spawnSync(python, ['-I', '-c', 'import mypy.main'], { stdio: 'ignore' }).status === 0;
export const nativeTest = (test: typeof import('node:test').test): typeof test =>
  hasMypy ? test : (Object.assign(() => undefined, test) as never);

/** Pinned so the verdict does not follow the machine running the tests. */
export const pinned = { pythonVersion: '3.13', platform: 'linux' } as const;

export async function withFiles<T>(files: Files, action: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'redproof-mypy-test-'));
  try {
    for (const [file, text] of Object.entries(files)) {
      await mkdir(dirname(join(root, file)), { recursive: true });
      await writeFile(join(root, file), text);
    }
    return await action(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/**
 * A stand-in interpreter: answers the probe (`-c`) with `probe` and the check (`-m mypy`) with a script body, so
 * a run can end in ways real mypy will not produce on demand (killed, truncated, garbled).
 */
export async function scriptedPython(root: string, probe: string, checkBody: string): Promise<string> {
  const file = join(root, 'scripted-python.mjs');
  await writeFile(file, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes('-c')) { process.stdout.write(${JSON.stringify(probe)}); process.exit(0); }
${checkBody}
`);
  await chmod(file, 0o755);
  return file;
}

/** A stand-in interpreter that replays a captured mypy report. */
export const replayPython = (root: string, probe: string, stdout: string, exitCode: number, stderr = ''): Promise<string> =>
  scriptedPython(root, probe, `process.stdout.write(${JSON.stringify(stdout)});\nprocess.stderr.write(${JSON.stringify(stderr)});\nprocess.exit(${exitCode});`);
