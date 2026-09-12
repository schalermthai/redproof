import { cp, lstat, mkdtemp, mkdir, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import type { UndoMutation } from '../../../domain/index.ts';
import {
  files as fileOps,
  json as jsonOps,
  text as textOps,
  type FileSelection,
  type RootContext,
} from '../../../inspect/index.ts';

async function existsAbsolute(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function capturePaths(root: string, paths: readonly string[]): Promise<UndoMutation> {
  const snapshotRoot = await mkdtemp(join(tmpdir(), 'redproof-mutation-'));
  const snapshots: Array<{ path: string; existed: boolean; backup: string }> = [];
  const absentAncestors = new Set<string>();

  try {
    for (const [index, path] of paths.entries()) {
      const target = resolve(root, path);
      const backup = join(snapshotRoot, String(index));
      const existed = await existsAbsolute(target);
      if (existed) await cp(target, backup, { recursive: true, preserveTimestamps: true });
      snapshots.push({ path, existed, backup });

      let parent = dirname(target);
      while (parent !== root && parent.startsWith(root + sep)) {
        if (!(await existsAbsolute(parent))) absentAncestors.add(parent);
        parent = dirname(parent);
      }
    }
  } catch (error) {
    await rm(snapshotRoot, { recursive: true, force: true });
    throw error;
  }

  let restored = false;
  return async () => {
    if (restored) return;

    for (const snapshot of snapshots.slice().reverse()) {
      const target = resolve(root, snapshot.path);
      await rm(target, { recursive: true, force: true });
      if (snapshot.existed) {
        await mkdir(dirname(target), { recursive: true });
        await cp(snapshot.backup, target, { recursive: true, preserveTimestamps: true });
      }
    }

    for (const ancestor of [...absentAncestors].sort((a, b) => b.length - a.length)) {
      try {
        await rmdir(ancestor);
      } catch {
        // Only remove directories that are still empty. If other mutation work populated
        // the directory, the Gate-level TreeStamp verification will catch the stale state.
      }
    }

    restored = true;
    await rm(snapshotRoot, { recursive: true, force: true });
  };
}

export type MutationContext = RootContext & {
  readonly files: {
    find(selection: FileSelection): ReturnType<typeof fileOps.find>;
    read(path: string): Promise<string>;
    write(path: string, content: string): Promise<void>;
    exists(path: string): Promise<boolean>;
    remove(path: string): Promise<void>;
    rename(from: string, to: string): Promise<void>;
  };
  readonly text: {
    find(options: Parameters<typeof textOps.find>[1]): ReturnType<typeof textOps.find>;
    findFirst(options: Parameters<typeof textOps.findFirst>[1]): ReturnType<typeof textOps.findFirst>;
  };
  readonly json: {
    query(options: Parameters<typeof jsonOps.query>[1]): ReturnType<typeof jsonOps.query>;
  };
  capture(paths: string | readonly string[]): Promise<UndoMutation>;
};

export function mutationContext(root: string): MutationContext {
  const ctx = { root };
  return {
    root,
    files: {
      find: selection => fileOps.find(ctx, selection),
      read: path => fileOps.read(ctx, path),
      write: (path, content) => fileOps.write(ctx, path, content),
      exists: path => fileOps.exists(ctx, path),
      remove: path => fileOps.remove(ctx, path),
      rename: (from, to) => fileOps.rename(ctx, from, to),
    },
    text: {
      find: options => textOps.find(ctx, options),
      findFirst: options => textOps.findFirst(ctx, options),
    },
    json: {
      query: options => jsonOps.query(ctx, options),
    },
    capture: paths => capturePaths(root, typeof paths === 'string' ? [paths] : paths),
  };
}
