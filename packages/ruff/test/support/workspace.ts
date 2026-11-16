import { chmod, cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const fixtures = fileURLToPath(new URL('../fixtures/', import.meta.url));

/** The Ruff under test: `ruff` on PATH, or the executable named by REDPROOF_RUFF_BIN. */
export const ruffBinary: string = process.env.REDPROOF_RUFF_BIN ?? 'ruff';

export async function withProject<T>(
  files: readonly string[],
  action: (root: string) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'redproof-ruff-test-'));
  try {
    for (const file of files) await cp(join(fixtures, file), join(root, file));
    return await action(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** A stand-in `ruff` executable, to rehearse report shapes real Ruff will not produce on demand. */
export async function fakeRuff(root: string, stdout: string, exitCode: number, stderr = '', version = 'ruff 0.17.5'): Promise<string> {
  const file = join(root, 'fake-ruff.mjs');
  // The listing must sit under the real root, as Ruff's does, or the adapter rightly says the named path was dropped.
  const listing = `${realpathSync(root)}/a.py\n`;
  await writeFile(file, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes('--version')) { process.stdout.write(${JSON.stringify(version + '\n')}); process.exit(0); }
if (args.includes('--show-files')) { process.stdout.write(${JSON.stringify(listing)}); process.exit(0); }
process.stdout.write(${JSON.stringify(stdout)});
process.stderr.write(${JSON.stringify(stderr)});
process.exit(${exitCode});
`);
  await chmod(file, 0o755);
  return file;
}

/** The version of the Ruff under test, e.g. [0, 17, 5]. Fails loudly when Ruff is missing: these tests need it. */
function installedRuffVersion(): readonly [number, number, number] {
  let out: string;
  try {
    out = execFileSync(ruffBinary, ['--version'], { encoding: 'utf8' });
  } catch (error) {
    throw new Error(`The @redproof/ruff tests need Ruff. Install it (pip install ruff) or set REDPROOF_RUFF_BIN. ${String(error)}`);
  }
  const m = /(\d+)\.(\d+)\.(\d+)/u.exec(out);
  if (!m) throw new Error(`Could not read a Ruff version from: ${out}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export const atLeast = (major: number, minor: number): boolean => {
  const v = installedRuffVersion();
  return v[0] > major || (v[0] === major && v[1] >= minor);
};
