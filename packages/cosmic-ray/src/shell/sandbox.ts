import { existsSync } from 'node:fs';
import { copyFile, lstat, mkdir, readdir, realpath, symlink } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { copyDisposition, isInsideDirectory } from '../core/copy.ts';

export type CopyOutcome =
  | { readonly kind: 'copied'; readonly bytes: number; readonly entries: number }
  | { readonly kind: 'too-large'; readonly bytes: number; readonly entries: number }
  | { readonly kind: 'collision'; readonly path: string };

/**
 * Copy `source` (an absolute, resolved directory) into `destination` as the mutation sandbox, stopping as soon as the size cap is passed.
 * Nothing in the copy may lead back to the real tree, because cosmic-ray writes mutants in place:
 * a link that stays inside the project is rebuilt inside the sandbox, a link that leaves it is copied by value
 * (environment directories excepted: they are linked, and a test can write into them), and a dangling link is dropped.
 */
export async function copyProject(source: string, destination: string, maxBytes: number, maxEntries: number): Promise<CopyOutcome> {
  let bytes = 0;
  let entries = 0;
  const visiting = new Set<string>();

  let collision: string | undefined;

  /** Two names that differ only by case land on one file on a case-insensitive disk: refuse instead of dropping one. */
  function collides(target: string): boolean {
    if (!existsSync(target)) return false;
    collision = target;
    return true;
  }

  async function copyFileCounted(from: string, to: string): Promise<boolean> {
    bytes += (await lstat(from)).size;
    if (bytes > maxBytes) return false;
    if (collides(to)) return false;
    await copyFile(from, to);
    return true;
  }

  async function walk(from: string, to: string): Promise<boolean> {
    const here = await realpath(from);
    if (visiting.has(here)) return true;
    visiting.add(here);
    await mkdir(to, { recursive: true });
    for (const entry of await readdir(from, { withFileTypes: true })) {
      const origin = join(from, entry.name);
      const disposition = copyDisposition(entry.name, existsSync(join(origin, 'pyvenv.cfg')));
      if (disposition === 'skip') continue;
      entries += 1;
      if (entries > maxEntries) return false;
      const target = join(to, entry.name);
      if (entry.isSymbolicLink()) {
        const resolved = await realpath(origin).catch(() => null);
        if (resolved === null) continue;
        // A link to the project itself or to one of its ancestors would pull the rest of the disk into the copy.
        if (isInsideDirectory(resolved, source)) continue;
        if (isInsideDirectory(source, resolved)) {
          await symlink(join(destination, relative(source, resolved)), target);
        } else if (disposition === 'link') {
          // The raw link text is relative to the original location and would dangle (or point elsewhere) from the sandbox.
          await symlink(resolved, target);
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

  if (await walk(source, destination)) return { kind: 'copied', bytes, entries };
  return collision === undefined ? { kind: 'too-large', bytes, entries } : { kind: 'collision', path: collision };
}
