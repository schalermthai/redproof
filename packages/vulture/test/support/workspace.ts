import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

export type Tool = { readonly label: string; readonly python: string; readonly binary: string };

const tool = (label: string, python: string): Tool => ({ label, python, binary: join(dirname(python), 'vulture') });

/**
 * The vultures under test: REDPROOF_VULTURE_PYTHON (the battle-test venv by default) and, when set,
 * REDPROOF_VULTURE_PYTHON_OLDEST, the python of a virtualenv with the oldest supported vulture.
 */
export const tools: readonly Tool[] = [
  tool('latest', process.env.REDPROOF_VULTURE_PYTHON ?? fileURLToPath(new URL('../../../../../24-vulture/.venv/bin/python', import.meta.url))),
  ...(process.env.REDPROOF_VULTURE_PYTHON_OLDEST ? [tool('oldest', process.env.REDPROOF_VULTURE_PYTHON_OLDEST)] : []),
].filter(candidate => existsSync(candidate.binary));

/** CI sets this beside the virtualenv: a missing vulture there must fail, not silently unregister the native tests. */
export const vultureRequired: boolean = process.env.REDPROOF_VULTURE_REQUIRED === '1';

/** The repo gate bans skipped tests, so without vulture the native tests are not registered at all. */
export const nativeTest: typeof test = tools.length ? test : (Object.assign(() => undefined, test) as never);

export async function withProject<T>(files: Readonly<Record<string, string>>, action: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'redproof-vulture-test-'));
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

/**
 * A stand-in `vulture` executable, to rehearse endings the real tool will not produce on demand.
 * It answers `--version`, and for a run prints `stdout` and `stderr`, then ends as `behaviour` says.
 */
export async function fakeVulture(root: string, options: {
  stdout: string; stderr: string; exitCode: number; version?: string;
  /** `hang` never exits (timeout); `kill` SIGKILLs itself after printing, like an out-of-memory kill. */
  behaviour?: 'hang' | 'kill';
}): Promise<string> {
  const file = join(root, 'fake-vulture.mjs');
  await writeFile(file, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes('--version')) { process.stdout.write(${JSON.stringify((options.version ?? 'vulture 2.16') + '\n')}); process.exit(0); }
process.stdout.write(${JSON.stringify(options.stdout)});
process.stderr.write(${JSON.stringify(options.stderr)});
${options.behaviour === 'hang' ? 'setInterval(() => {}, 1000);' : options.behaviour === 'kill' ? "process.kill(process.pid, 'SIGKILL');" : `process.exit(${options.exitCode});`}
`);
  await chmod(file, 0o755);
  return file;
}
