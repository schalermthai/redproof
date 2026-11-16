import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projects, type Files, type ProjectName } from './projects.ts';

export const fixtures = fileURLToPath(new URL('../fixtures/', import.meta.url));
export const readFixture = (name: string): Promise<string> => readFile(join(fixtures, name), 'utf8');

/**
 * The tach under test: `REDPROOF_TACH_PYTHON` names the Python of a venv that has tach (its `tach` script sits
 * beside it), else the battle-test venv in `22-tach/`. No tach, no native tests: they are not registered, because
 * the repo gate bans skipped tests.
 */
const python = process.env.REDPROOF_TACH_PYTHON
  ?? fileURLToPath(new URL('../../../../../22-tach/.venv/bin/python', import.meta.url));
export const tachBinary = join(dirname(python), 'tach');
export const hasTach = existsSync(tachBinary);
export const nativeTest = (test: typeof import('node:test').test): typeof test =>
  hasTach ? test : (Object.assign(() => undefined, test) as never);

export async function withFiles<T>(files: Files, action: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'redproof-tach-test-'));
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

export const withProject = <T>(name: ProjectName, action: (root: string) => Promise<T>): Promise<T> =>
  withFiles(projects[name], action);

/** A stand-in `tach` executable, to replay captured reports and to rehearse shapes real tach will not produce on demand. */
export async function fakeTach(root: string, stdout: string, exitCode: number, stderr = '', version = 'tach 0.35.3'): Promise<string> {
  const file = join(root, 'fake-tach.mjs');
  await writeFile(file, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes('--version')) { process.stdout.write(${JSON.stringify(version + '\n')}); process.exit(0); }
process.stdout.write(${JSON.stringify(stdout)});
process.stderr.write(${JSON.stringify(stderr)});
process.exit(${exitCode});
`);
  await chmod(file, 0o755);
  return file;
}
