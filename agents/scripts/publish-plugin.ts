import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertReleaseReadiness, compareVersions, marketplaceBranch, marketplaceCatalogs, releaseVersion } from './plugin-release.ts';

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

async function releaseFiles(directory: string): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  async function walk(path: string, prefix: string) {
    if (!(await lstat(path)).isDirectory()) throw new Error(`Release directory must not be a symlink: ${path}`);
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.name === '.git' || !/^[A-Za-z0-9_.-]+$/.test(entry.name)) throw new Error(`Invalid release path: ${name}`);
      if (entry.isDirectory()) await walk(join(path, entry.name), `${name}/`);
      else if (entry.isFile()) files.set(name, await readFile(join(path, entry.name)));
      else throw new Error(`Release contains a symlink or special file: ${name}`);
    }
  }
  await walk(directory, '');
  return files;
}

export async function validatePluginRelease(directory: string) {
  const files = await releaseFiles(directory);
  function json(name: string) {
    const bytes = files.get(name);
    if (!bytes) throw new Error(`Missing release file: ${name}`);
    return JSON.parse(bytes.toString());
  }
  const metadata = json('release.json');
  const version = releaseVersion(metadata.sourceTag);
  if (metadata.version !== version || metadata.bundleTag !== `plugin-bundle-v${version}` || !/^[a-f0-9]{40}$/.test(metadata.sourceCommit)) {
    throw new Error('Inconsistent release identity');
  }
  const prefix = 'plugins/redproof/';
  const inventory = json(prefix + 'bundle-files.json');
  if (inventory.version !== 1 || inventory.algorithm !== 'sha256' || !inventory.files || typeof inventory.files !== 'object') {
    throw new Error('Invalid bundle inventory');
  }
  for (const [name, hash] of Object.entries(inventory.files)) {
    if (!name.split('/').every(p => /^[A-Za-z0-9_.-]+$/.test(p) && p !== '.' && p !== '..')) throw new Error('Invalid inventory path');
    const bytes = files.get(prefix + name);
    if (!bytes || sha256(bytes) !== hash) throw new Error(`Bundle hash mismatch: ${name}`);
  }
  const expected = ['.agents/plugins/marketplace.json', '.claude-plugin/marketplace.json', 'release.json',
    'release-readiness.json', 'README.md', 'CHANGELOG.md', prefix + 'bundle-files.json',
    ...Object.keys(inventory.files).map(name => prefix + name)].sort();
  if (JSON.stringify([...files.keys()].sort()) !== JSON.stringify(expected)) throw new Error('Release has missing or unexpected files');
  const bundleSha256 = sha256(files.get(prefix + 'bundle-files.json')!);
  if (metadata.bundleSha256 !== bundleSha256) throw new Error('Release inventory hash mismatch');
  const manifest = json(prefix + '.codex-plugin/plugin.json');
  for (const path of ['.codex-plugin/plugin.json', '.claude-plugin/plugin.json', 'plugin.json']) {
    const identity = json(prefix + path);
    if (identity.name !== 'redproof' || identity.version !== version) throw new Error('Host manifest identity mismatch');
  }
  const catalogs = marketplaceCatalogs(manifest);
  for (const [path, catalog] of [['.agents/plugins/marketplace.json', catalogs.codex], ['.claude-plugin/marketplace.json', catalogs.claude]] as const) {
    if (JSON.stringify(json(path)) !== JSON.stringify(catalog)) throw new Error(`Unexpected marketplace catalog: ${path}`);
  }
  assertReleaseReadiness(json('release-readiness.json'), version, bundleSha256);
  return { files, metadata: metadata as { version: string; sourceTag: string; sourceCommit: string; bundleTag: string; bundleSha256: string } };
}

/** Publish an immutable snapshot and advance only our generated branch, atomically. */
export async function publishPluginRelease(directory: string, remote: string) {
  const { files, metadata } = await validatePluginRelease(directory);
  const scratch = await mkdtemp(join(tmpdir(), 'redproof-publish-'));
  function git(args: string[], input?: Buffer): string {
    return execFileSync('git', ['-C', scratch, '-c', 'user.name=Redproof release automation',
      '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com', ...args], {
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60_000,
      ...(input === undefined ? {} : { input }),
    }).trim();
  }
  try {
    git(['init', '--quiet']);
    git(['remote', 'add', 'origin', remote]);
    const branchRef = `refs/heads/${marketplaceBranch}`;
    const tagRef = `refs/tags/${metadata.bundleTag}`;
    const refs = git(['ls-remote', '--refs', 'origin', branchRef, tagRef]).split('\n').filter(Boolean);
    const hasBranch = refs.some(line => line.endsWith(`\t${branchRef}`));
    const hasTag = refs.some(line => line.endsWith(`\t${tagRef}`));
    if (hasBranch) git(['fetch', '--quiet', '--no-tags', 'origin', `${branchRef}:${branchRef}`]);
    if (hasTag) git(['fetch', '--quiet', '--no-tags', 'origin', `${tagRef}:${tagRef}`]);
    // Create a fresh index, without checking out or deleting any existing worktree.
    for (const [name, bytes] of [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
      const hash = git(['hash-object', '-w', '--stdin'], bytes);
      git(['update-index', '--add', '--cacheinfo', `100644,${hash},${name}`]);
    }
    const tree = git(['write-tree']);
    if (hasTag) {
      if (git(['rev-parse', `${tagRef}^{tree}`]) !== tree) throw new Error(`Refusing to overwrite immutable ${metadata.bundleTag}`);
      if (!hasBranch) throw new Error('Distribution tag exists but marketplace branch is missing; restore it manually');
      // A retry of an older release must not move the marketplace backwards.
      return { status: 'already-published', tag: metadata.bundleTag };
    }
    if (hasBranch) {
      const previous = JSON.parse(git(['show', `${branchRef}:release.json`]));
      if (compareVersions(metadata.version, previous.version) <= 0) {
        throw new Error(`Refusing non-increasing marketplace version ${metadata.version}; current is ${previous.version}`);
      }
    }
    const parent = hasBranch ? ['-p', git(['rev-parse', branchRef])] : [];
    const commit = git(['commit-tree', tree, ...parent, '-m', `Release Redproof plugin ${metadata.version}\n\nSource: ${metadata.sourceCommit}`]);
    // No force push. A competing release or unsupported atomic push fails closed.
    git(['push', '--atomic', 'origin', `${commit}:${branchRef}`, `${commit}:${tagRef}`]);
    return { status: 'published', tag: metadata.bundleTag, commit };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

async function main(args: string[]) {
  if (args.length === 2 && args[0] === '--verify') {
    const { metadata } = await validatePluginRelease(resolve(args[1]!));
    console.log(`Release readiness passed for ${metadata.sourceTag}`);
  } else if (args.length === 5 && args[0] === '--directory' && args[2] === '--remote' && args[4] === '--publish') {
    console.log(JSON.stringify(await publishPluginRelease(resolve(args[1]!), args[3]!), null, 2));
  } else {
    throw new Error('Usage: publish-plugin.ts --verify <directory> OR --directory <directory> --remote <git-url> --publish');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
