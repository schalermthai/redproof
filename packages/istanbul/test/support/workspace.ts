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
export function sample(file = 'source.js', hits = [1, 0]) {
  const loc = (line: number) => ({ start: { line, column: 0 }, end: { line, column: 10 } });
  return { [file]: { path: file,
    statementMap: { '0': loc(1), '1': loc(2) }, s: { '0': hits[0], '1': hits[1] },
    fnMap: { '0': { name: 'compute', decl: loc(1), loc: loc(1) } }, f: { '0': hits[0] },
    branchMap: { '0': { type: 'if', loc: loc(1), locations: [loc(1), loc(2)] } }, b: { '0': hits },
  } };
}
