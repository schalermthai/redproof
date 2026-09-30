import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildPlugin } from './build-plugin.ts';

const repository = fileURLToPath(new URL('../../', import.meta.url));
export const marketplaceBranch = 'plugin-marketplace';
export const marketplaceName = 'redproof-plugins';
const versionPattern = '(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)';

export function releaseVersion(tag: string): string {
  if (!new RegExp(`^plugin-v${versionPattern}$`).test(tag)) {
    throw new Error('Expected a plugin release tag such as plugin-v0.1.0 (not a library v tag)');
  }
  return tag.slice('plugin-v'.length);
}

export function compareVersions(a: string, b: string): number {
  for (const version of [a, b]) {
    if (!new RegExp(`^${versionPattern}$`).test(version)) throw new Error(`Invalid plugin version: ${version}`);
  }
  const left = a.split('.').map(BigInt);
  const right = b.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) {
    if (left[i]! > right[i]!) return 1;
    if (left[i]! < right[i]!) return -1;
  }
  return 0;
}

export function marketplaceCatalogs(manifest: { name: string; description: string; author: { name: string } }) {
  return {
    codex: {
      name: marketplaceName,
      interface: { displayName: 'Redproof' },
      plugins: [{
        name: manifest.name,
        source: { source: 'local', path: './plugins/redproof' },
        policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
        category: 'Productivity',
      }],
    },
    claude: {
      name: marketplaceName,
      description: 'Redproof skills for discovering, designing and proving project guardrails.',
      owner: manifest.author,
      plugins: [{ name: manifest.name, source: './plugins/redproof', description: manifest.description }],
    },
  };
}

export const hostChecks = ['installation', 'publicSkills', 'approvedHandoff', 'reviewUI', 'authorizationBoundaries'] as const;

/** A human attestation, not a substitute for evaluations or a cryptographic signature. */
export function assertReleaseReadiness(value: unknown, version: string, bundleSha256: string): void {
  const record = value as { version?: string; bundleSha256?: string; hosts?: Record<string, {
    version?: string; evidence?: string; checks?: Record<string, string>;
  }> } | null;
  const problems: string[] = [];
  if (record?.version !== version) problems.push('readiness version does not match the release');
  if (record?.bundleSha256 !== bundleSha256) problems.push('readiness hash does not match this exact plugin bundle');
  for (const host of ['codex', 'claude']) {
    const result = record?.hosts?.[host];
    if (typeof result?.version !== 'string' || !result.version.trim()) problems.push(`${host}: record the tested host version`);
    if (typeof result?.evidence !== 'string' || !result.evidence.trim()) problems.push(`${host}: record the evidence location`);
    for (const check of hostChecks) {
      if (result?.checks?.[check] !== 'pass') problems.push(`${host}: ${check} has not passed`);
    }
  }
  if (problems.length) throw new Error(`Plugin release is not ready:\n- ${problems.join('\n- ')}\nComplete agents/plugin/release-readiness.json using agents/plugin/RELEASING.md. A dry run is still allowed.`);
}

export async function buildPluginRelease(options: { tag: string; sourceCommit: string; destination?: string; sourceRoot?: string }) {
  const version = releaseVersion(options.tag);
  if (!/^[a-f0-9]{40}$/.test(options.sourceCommit)) throw new Error('Expected a full source Git commit SHA');
  const root = options.sourceRoot ?? repository;
  const manifest = JSON.parse(await readFile(join(root, 'agents/plugin/redproof/.codex-plugin/plugin.json'), 'utf8'));
  if (manifest.version !== version) throw new Error(`Tag ${options.tag} disagrees with plugin manifest ${manifest.version}`);
  const notes = await readFile(join(root, 'agents/plugin/CHANGELOG.md'), 'utf8');
  if (!notes.includes(`## ${version}\n`)) throw new Error(`Missing plugin changelog entry for ${version}`);
  const readiness = JSON.parse(await readFile(join(root, 'agents/plugin/release-readiness.json'), 'utf8'));
  const guide = await readFile(join(root, 'agents/plugin/MARKETPLACE.md'), 'utf8');
  const output = options.destination ? resolve(options.destination) : join(await mkdtemp(join(tmpdir(), 'redproof-release-')), 'marketplace');
  await mkdir(output); // Deliberately refuses existing destinations, including symlinks.
  await mkdir(join(output, 'plugins'));
  const bundle = await buildPlugin(join(output, 'plugins/redproof'), root);
  const bundleSha256 = createHash('sha256').update(await readFile(join(bundle, 'bundle-files.json'))).digest('hex');
  const catalogs = marketplaceCatalogs(manifest);
  const metadata = { version, sourceTag: options.tag, sourceCommit: options.sourceCommit,
    bundleTag: `plugin-bundle-v${version}`, bundleSha256 };
  const files: Record<string, string> = {
    '.agents/plugins/marketplace.json': JSON.stringify(catalogs.codex, null, 2) + '\n',
    '.claude-plugin/marketplace.json': JSON.stringify(catalogs.claude, null, 2) + '\n',
    'release.json': JSON.stringify(metadata, null, 2) + '\n',
    'release-readiness.json': JSON.stringify(readiness, null, 2) + '\n',
    'README.md': guide,
    'CHANGELOG.md': notes,
  };
  for (const [name, bytes] of Object.entries(files)) {
    await mkdir(dirname(join(output, name)), { recursive: true });
    await writeFile(join(output, name), bytes, { flag: 'wx' });
  }
  return { output, ...metadata };
}

async function main(args: string[]) {
  if (args.length !== 6 || args[0] !== '--tag' || args[2] !== '--source-commit' || args[4] !== '--out') {
    throw new Error('Usage: npm run plugin:release:build -- --tag plugin-v0.1.0 --source-commit <full-sha> --out <new-directory>');
  }
  console.log(JSON.stringify(await buildPluginRelease({ tag: args[1]!, sourceCommit: args[3]!, destination: args[5]! }), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
