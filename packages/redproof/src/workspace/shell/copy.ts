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
import { copiesEntry, copyName, stampsEntry } from '../core/copy-policy.ts';
import { assessFreshness, type Freshness, type TreeStamp } from '../core/freshness.ts';
import { fingerprint, stampRecord, type StampEntry } from '../core/stamp.ts';



export type GateWorkspace = {
  readonly root: string;
  readonly baseline: TreeStamp;
};

async function copyEntry(source: string, target: string, sourceRoot: string): Promise<void> {
  const info = await lstat(source);

  if (info.isDirectory()) {
    await mkdir(target, { recursive: true });
    await chmod(target, info.mode);
    const entries = await readdir(source, { withFileTypes: true });
    for (const entry of entries) {
      if (!copiesEntry(entry.name, source === sourceRoot)) continue;
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

async function readStampEntry(root: string, absolute: string): Promise<StampEntry | null> {
  const path = relative(root, absolute).replaceAll('\\', '/');
  const info = await lstat(absolute);
  const mode = info.mode;

  if (info.isDirectory()) return { kind: 'directory', path, mode };
  if (info.isSymbolicLink()) return { kind: 'link', path, mode, target: await readlink(absolute) };
  if (info.isFile()) return { kind: 'file', path, mode, contents: await readFile(absolute) };
  return null;
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
    if (!stampsEntry(entry.name, current === root)) continue;

    const absolute = join(current, entry.name);
    const stampEntry = await readStampEntry(root, absolute);
    if (!stampEntry) continue;

    const record = stampRecord(stampEntry);
    for (const part of record) hash.update(part);
    fingerprints[stampEntry.path] = fingerprint(record);
    count += 1;

    if (stampEntry.kind === 'directory') count += await collectStamp(root, absolute, hash, fingerprints);
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

// Outside the project, so config lookups cannot escape the copy and find the original.
async function createCopyRoot(gateId: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `redproof-${copyName(gateId)}-`));
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
