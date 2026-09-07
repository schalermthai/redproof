import { glob, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { isExcluded, normalizePath, selectionParts, type FileSelection } from '../core/selection.ts';

export type RootContext = { readonly root: string };

async function findFiles(ctx: RootContext, selection: FileSelection): Promise<readonly string[]> {
  const { include, exclude } = selectionParts(selection);
  const found = new Set<string>();

  for (const pattern of include) {
    for await (const entry of glob(pattern, { cwd: ctx.root })) {
      const path = normalizePath(entry);
      if (isExcluded(path, exclude)) continue;
      const info = await stat(resolve(ctx.root, path));
      if (info.isFile()) found.add(path);
    }
  }

  return [...found].sort();
}

async function readText(ctx: RootContext, path: string): Promise<string> {
  return readFile(resolve(ctx.root, path), 'utf8');
}

async function writeText(ctx: RootContext, path: string, content: string): Promise<void> {
  const target = resolve(ctx.root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
}

async function pathExists(ctx: RootContext, path: string): Promise<boolean> {
  try {
    await stat(resolve(ctx.root, path));
    return true;
  } catch {
    return false;
  }
}

async function removePath(ctx: RootContext, path: string): Promise<void> {
  await rm(resolve(ctx.root, path), { recursive: true, force: true });
}

async function renamePath(ctx: RootContext, from: string, to: string): Promise<void> {
  const target = resolve(ctx.root, to);
  await mkdir(dirname(target), { recursive: true });
  await rename(resolve(ctx.root, from), target);
}

export const files = {
  find: findFiles,
  read: readText,
  write: writeText,
  exists: pathExists,
  remove: removePath,
  rename: renamePath,
};
