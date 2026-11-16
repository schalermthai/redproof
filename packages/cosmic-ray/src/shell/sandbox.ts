import { copyFile, lstat, mkdir, readdir, readlink, realpath, symlink } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { copyDisposition, isInsideDirectory } from '../core/copy.ts';

export type CopyOutcome =
  | { readonly kind: 'copied'; readonly bytes: number }
  | { readonly kind: 'too-large'; readonly bytes: number };

/**
 * Copy `source` (an absolute, resolved directory) into `destination` as the mutation sandbox, stopping as soon as the size cap is passed.
 * Nothing in the copy may lead back to the real tree, because cosmic-ray writes mutants in place:
 * a link that stays inside the project is rebuilt inside the sandbox, a link that leaves it is copied by value
 * (environment directories excepted, which are linked read-only by convention), and a dangling link is dropped.
 */
export async function copyProject(source: string, destination: string, maxBytes: number): Promise<CopyOutcome> {
  let bytes = 0;
  const visiting = new Set<string>();

  async function copyFileCounted(from: string, to: string): Promise<boolean> {
    bytes += (await lstat(from)).size;
    if (bytes > maxBytes) return false;
    await copyFile(from, to);
    return true;
  }

  async function walk(from: string, to: string): Promise<boolean> {
    const here = await realpath(from);
    if (visiting.has(here)) return true;
    visiting.add(here);
    await mkdir(to, { recursive: true });
    for (const entry of await readdir(from, { withFileTypes: true })) {
      const disposition = copyDisposition(entry.name);
      if (disposition === 'skip') continue;
      const origin = join(from, entry.name);
      const target = join(to, entry.name);
      if (entry.isSymbolicLink()) {
        const resolved = await realpath(origin).catch(() => null);
        if (resolved === null) continue;
        if (isInsideDirectory(source, resolved)) {
          await symlink(join(destination, relative(source, resolved)), target);
        } else if (disposition === 'link') {
          await symlink(await readlink(origin), target);
        } else if ((await lstat(resolved)).isDirectory()) {
          if (!await walk(resolved, target)) return false;
        } else if (!await copyFileCounted(resolved, target)) {
          return false;
        }
      } else if (entry.isDirectory()) {
        if (disposition === 'link') await symlink(origin, target, 'dir');
        else if (!await walk(origin, target)) return false;
      } else if (entry.isFile()) {
        if (!await copyFileCounted(origin, target)) return false;
      }
    }
    visiting.delete(here);
    return true;
  }

  return await walk(source, destination) ? { kind: 'copied', bytes } : { kind: 'too-large', bytes };
}
