import { createHash } from 'node:crypto';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  stat,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

import { assessFreshness, type Freshness, type TreeStamp } from '../core/freshness.ts';

export type { Freshness, TreeStamp } from '../core/freshness.ts';

export type GateWorkspace = {
  readonly root: string;
  readonly baseline: TreeStamp;
};

const OMIT_FROM_COPY = new Set(['.git', '.redproof']);

async function copyEntry(source: string, target: string, sourceRoot: string): Promise<void> {
  const info = await lstat(source);

  if (info.isDirectory()) {
    await mkdir(target, { recursive: true });
    await chmod(target, info.mode);
    const entries = await readdir(source, { withFileTypes: true });
    for (const entry of entries) {
      if (
        OMIT_FROM_COPY.has(entry.name)
        || (source === sourceRoot && entry.name === 'node_modules')
      ) continue;
      await copyEntry(join(source, entry.name), join(target, entry.name), sourceRoot);
    }
    return;
  }

  if (info.isSymbolicLink()) {
    await mkdir(dirname(target), { recursive: true });
    await symlink(await readlink(source), target);
    return;
  }

  if (info.isFile()) {
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
    await chmod(target, info.mode);
  }
}

function fingerprint(...parts: (string | Buffer)[]): string {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part);
  return hash.digest('hex');
}

async function collectStamp(
  root: string,
  current: string,
  hash: ReturnType<typeof createHash>,
  fingerprints: Record<string, string>,
): Promise<number> {
  const entries = await readdir(current, { withFileTypes: true });
  let count = 0;

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (current === root && entry.name === '.redproof') continue;

    const absolute = join(current, entry.name);
    const rel = relative(root, absolute).replaceAll('\\', '/');
    const info = await lstat(absolute);
    const mode = info.mode & 0o777;

    if (info.isDirectory()) {
      const metadata = `D\0${rel}\0${mode}\0`;
      hash.update(metadata);
      fingerprints[rel] = fingerprint(metadata);
      count += 1;
      count += await collectStamp(root, absolute, hash, fingerprints);
      continue;
    }

    if (info.isSymbolicLink()) {
      const metadata = `L\0${rel}\0${mode}\0${await readlink(absolute)}\0`;
      hash.update(metadata);
      fingerprints[rel] = fingerprint(metadata);
      count += 1;
      continue;
    }

    if (info.isFile()) {
      const metadata = `F\0${rel}\0${mode}\0`;
      const contents = await readFile(absolute);
      hash.update(metadata);
      hash.update(contents);
      hash.update('\0');
      fingerprints[rel] = fingerprint(metadata, contents, '\0');
      count += 1;
    }
  }

  return count;
}

export async function stampTree(root: string): Promise<TreeStamp> {
  const absolute = resolve(root);
  const hash = createHash('sha256');
  const fingerprints: Record<string, string> = Object.create(null);
  const entries = await collectStamp(absolute, absolute, hash, fingerprints);
  return { digest: hash.digest('hex'), entries, fingerprints };
}

export async function verifyTree(root: string, baseline: TreeStamp): Promise<Freshness> {
  return assessFreshness(baseline, await stampTree(root));
}

function safeName(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return safe || 'gate';
}

// Outside the project, so config lookups cannot escape the copy and find the original.
async function createCopyRoot(gateId: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `redproof-${safeName(gateId)}-`));
}

async function findDependencies(projectRoot: string): Promise<string | null> {
  let current = resolve(projectRoot);

  for (;;) {
    const candidate = join(current, 'node_modules');

    try {
      // Follow a dependency-directory symlink. A Redproof run can itself execute
      // Redproof in a copied workspace, so the nearest node_modules may already
      // be the link created by an outer copy. Resolve to the real directory, so
      // a nested copy never links through the copy above it.
      if ((await stat(candidate)).isDirectory()) return realpath(candidate);
    } catch {
      // keep walking up
    }

    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

// node_modules is not copied, so link it for module resolution.
async function linkDependencies(projectRoot: string, target: string): Promise<void> {
  const source = await findDependencies(projectRoot);
  if (source === null) return;

  await symlink(source, join(target, 'node_modules'), 'dir');
}

export async function copyGateWorkspace(projectRoot: string, gateId: string): Promise<GateWorkspace> {
  const target = await createCopyRoot(gateId);
  const sourceRoot = resolve(projectRoot);

  await copyEntry(sourceRoot, target, sourceRoot);
  await linkDependencies(sourceRoot, target);
  const baseline = await stampTree(target);
  return { root: target, baseline };
}

export async function releaseGateWorkspace(workspace: GateWorkspace): Promise<void> {
  await rm(workspace.root, { recursive: true, force: true });
}

export function pathInsideCopy(projectRoot: string, workspaceRoot: string, projectFile: string): string {
  return join(workspaceRoot, relative(projectRoot, projectFile));
}
