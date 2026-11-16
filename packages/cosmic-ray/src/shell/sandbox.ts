import { copyFile, lstat, mkdir, readdir, readlink, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { copyDisposition } from '../core/copy.ts';

export type CopyOutcome =
  | { readonly kind: 'copied'; readonly bytes: number }
  | { readonly kind: 'too-large'; readonly bytes: number };

/** Copy `source` into `destination` as the mutation sandbox, stopping as soon as the size cap is passed. */
export async function copyProject(source: string, destination: string, maxBytes: number): Promise<CopyOutcome> {
  let bytes = 0;

  async function walk(from: string, to: string): Promise<boolean> {
    await mkdir(to, { recursive: true });
    for (const entry of await readdir(from, { withFileTypes: true })) {
      const disposition = copyDisposition(entry.name);
      if (disposition === 'skip') continue;
      const origin = join(from, entry.name);
      const target = join(to, entry.name);
      if (entry.isSymbolicLink()) {
        await symlink(await readlink(origin), target);
      } else if (entry.isDirectory()) {
        if (disposition === 'link') await symlink(origin, target, 'dir');
        else if (!await walk(origin, target)) return false;
      } else if (entry.isFile()) {
        bytes += (await lstat(origin)).size;
        if (bytes > maxBytes) return false;
        await copyFile(origin, target);
      }
    }
    return true;
  }

  return await walk(source, destination) ? { kind: 'copied', bytes } : { kind: 'too-large', bytes };
}
