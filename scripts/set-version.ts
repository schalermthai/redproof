// Sets one version across every publishable package.
//
// Usage: node --experimental-strip-types scripts/set-version.ts 1.2.3

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const PACKAGE_DIRS = [
  'packages/knip',
  'packages/redproof',
  'packages/adapter-tck',
  'packages/eslint',
  'packages/dependency-cruiser',
  'packages/stryker',
  'packages/testing',
  'packages/istanbul',
] as const;

const INTERNAL_DEPENDENCIES = new Set([
  'redproof',
  '@redproof/adapter-tck',
]);

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

type Manifest = {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

function readVersionArgument(argv: readonly string[]): string {
  const raw = argv[2];

  if (raw === undefined) {
    throw new Error('Missing version argument. Usage: set-version.ts <version>');
  }

  const version = raw.startsWith('v') ? raw.slice(1) : raw;

  if (!SEMVER.test(version)) {
    throw new Error(`Not a valid semantic version: ${raw}`);
  }

  return version;
}

async function setVersion(dir: string, version: string): Promise<void> {
  const file = resolve(dir, 'package.json');
  const manifest = JSON.parse(await readFile(file, 'utf8')) as Manifest;

  manifest.version = version;

  for (const section of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
    for (const dependency of Object.keys(manifest[section] ?? {})) {
      if (INTERNAL_DEPENDENCIES.has(dependency)) manifest[section]![dependency] = version;
    }
  }

  await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${manifest.name ?? dir} -> ${version}`);
}

const version = readVersionArgument(process.argv);

for (const dir of PACKAGE_DIRS) {
  await setVersion(dir, version);
}
