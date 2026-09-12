import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function withProject<T>(action: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'redproof-knip-test-'));
  try {
    await symlink(fileURLToPath(new URL('../../../../node_modules', import.meta.url)), join(root, 'node_modules'), 'dir');
    await writeFile(join(root, 'package.json'), '{"name":"receipt-project","type":"module"}');
    await writeFile(join(root, 'knip.json'), '{"entry":["index.ts"],"project":["*.ts"]}');
    await writeFile(join(root, 'index.ts'), "import { receive } from './receive.ts';\nreceive();\n");
    await writeFile(join(root, 'receive.ts'), 'export function receive() { return 1; }\n');
    return await action(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}
