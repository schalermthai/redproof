import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
export async function withWorkspace<T>(run: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'redproof-istanbul-test-'));
  try {
    await symlink(fileURLToPath(new URL('../../../../node_modules', import.meta.url)), join(root, 'node_modules'), 'dir');
    return await run(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}
