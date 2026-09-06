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
  rm,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

import { assessFreshness, type Freshness, type TreeStamp } from './core/restoration.ts';

export type { Freshness, TreeStamp } from './core/restoration.ts';

export type GateWorkspace = {
  readonly root: string;
  readonly baseline: TreeStamp;
};

const OMIT_FROM_COPY = new Set(['.git', '.redproof', 'node_modules']);

async function copyEntry(source: string, target: string): Promise<void> {
  const info = await lstat(source);

  if (info.isDirectory()) {
    await mkdir(target, { recursive: true });
    await chmod(target, info.mode);
    const entries = await readdir(source, { withFileTypes: true });
    for (const entry of entries) {
      if (OMIT_FROM_COPY.has(entry.name)) continue;
      await copyEntry(join(source, entry.name), join(target, entry.name));
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

async function collectStamp(root: string, current: string, hash: ReturnType<typeof createHash>): Promise<number> {
  const entries = await readdir(current, { withFileTypes: true });
  let count = 0;

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (current === root && entry.name === '.redproof') continue;

    const absolute = join(current, entry.name);
    const rel = relative(root, absolute).replaceAll('\\', '/');
    const info = await lstat(absolute);
    const mode = info.mode & 0o777;

    if (info.isDirectory()) {
      hash.update(`D\0${rel}\0${mode}\0`);
      count += 1;
      count += await collectStamp(root, absolute, hash);
      continue;
    }

    if (info.isSymbolicLink()) {
      hash.update(`L\0${rel}\0${mode}\0${await readlink(absolute)}\0`);
      count += 1;
      continue;
    }

    if (info.isFile()) {
      hash.update(`F\0${rel}\0${mode}\0`);
      hash.update(await readFile(absolute));
      hash.update('\0');
      count += 1;
    }
  }

  return count;
}

export async function stampTree(root: string): Promise<TreeStamp> {
  const absolute = resolve(root);
  const hash = createHash('sha256');
  const entries = await collectStamp(absolute, absolute, hash);
  return { digest: hash.digest('hex'), entries };
}

export async function verifyTree(root: string, baseline: TreeStamp): Promise<Freshness> {
  return assessFreshness(baseline, await stampTree(root));
}

function safeName(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return safe || 'gate';
}

// The copy must NOT live inside the project. Tools such as ESLint, tsc and
// dependency-cruiser search parent directories for their configuration. A copy
// under the project would still see the project's own config files, so a
// mutation that hides one inside the copy would have no effect, and a refuse
// Proof would report a false PASS. The OS temporary directory has no such
// ancestors.
async function createCopyRoot(gateId: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `redproof-${safeName(gateId)}-`));
}

// Find the node_modules that the project itself would resolve against. Node
// walks up from a file until it finds one, so a workspace package with hoisted
// dependencies resolves against the repository root, not its own directory.
async function findDependencies(projectRoot: string): Promise<string | null> {
  let current = resolve(projectRoot);

  for (;;) {
    const candidate = join(current, 'node_modules');

    try {
      if ((await lstat(candidate)).isDirectory()) return candidate;
    } catch {
      // Not here. Keep walking up.
    }

    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

// node_modules is never copied, because it is large and unchanged by a
// mutation. Inside the project the copy could still resolve it from an ancestor
// directory. Outside the project it cannot, so link it at the copy root.
async function linkDependencies(projectRoot: string, target: string): Promise<void> {
  const source = await findDependencies(projectRoot);
  if (source === null) return;

  await symlink(source, join(target, 'node_modules'), 'dir');
}

export async function copyGateWorkspace(projectRoot: string, gateId: string): Promise<GateWorkspace> {
  const target = await createCopyRoot(gateId);

  await copyEntry(projectRoot, target);
  await linkDependencies(projectRoot, target);
  const baseline = await stampTree(target);
  return { root: target, baseline };
}

export async function releaseGateWorkspace(workspace: GateWorkspace): Promise<void> {
  // The copy root is a temporary directory of our own, so removing it is safe.
  // rm does not follow the node_modules symlink, so the project's real
  // dependencies are untouched.
  await rm(workspace.root, { recursive: true, force: true });
}

export function pathInsideCopy(projectRoot: string, workspaceRoot: string, projectFile: string): string {
  return join(workspaceRoot, relative(projectRoot, projectFile));
}
