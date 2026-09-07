import { glob, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  breach,
  counting,
  defineGate,
  defineProofs,
  defineRules,
  locate,
  mutate,
  proof,
  result,
} from 'redproof';
import {
  evaluateRepositoryPolicy,
  type ManifestSnapshot,
  type RepositoryPolicyRule,
  type RepositorySnapshot,
} from './support/repository-policy-model.ts';

const rules = defineRules({
  packageInventory: {
    id: 'repository/packages-inventory-is-consistent',
    description: 'Every publishable package participates in every build and release stage.',
  },
  versionAlignment: {
    id: 'repository/package-versions-and-internal-pins-align',
    description: 'All packages share one version and internal Redproof dependencies use it exactly.',
  },
  publicFiles: {
    id: 'repository/public-files-are-declared',
    description: 'Public runtime, type, binary, subpath, and schema surfaces are source-backed and declared.',
  },
  automationVerification: {
    id: 'repository/automation-enforces-verification',
    description: 'CI and publishing retain self-check, proof, build, and consumer verification.',
  },
  docsLinks: {
    id: 'repository/docs-relative-links-resolve',
    description: 'Repository and skill documentation cannot point to missing local files.',
  },
});

const ruleByFinding: Record<RepositoryPolicyRule, typeof rules[keyof typeof rules]> = rules;

async function read(root: string, file: string): Promise<string> {
  return readFile(join(root, file), 'utf8');
}

async function snapshot(root: string): Promise<RepositorySnapshot> {
  const rootManifest = JSON.parse(await read(root, 'package.json')) as {
    scripts?: Record<string, string>;
  };
  const manifestFiles: string[] = [];
  for await (const file of glob('packages/*/package.json', { cwd: root })) manifestFiles.push(file);
  manifestFiles.sort();

  const manifests: ManifestSnapshot[] = await Promise.all(manifestFiles.map(async file => {
    const manifest = JSON.parse(await read(root, file)) as ManifestSnapshot['manifest'] & {
      name?: string;
      version?: string;
    };
    if (!manifest.name || !manifest.version) throw new Error(`${file} is missing name or version.`);
    return {
      file,
      dir: file.slice(0, -'/package.json'.length),
      name: manifest.name,
      version: manifest.version,
      manifest,
    };
  }));

  const existingPaths = new Set<string>();
  for (const pattern of ['README.md', 'LICENSE', '.github/**/*', 'docs/**/*', 'fixtures/**/*', 'gates/**/*', 'packages/**/*', 'scripts/**/*', 'skills/**/*']) {
    for await (const file of glob(pattern, { cwd: root })) {
      if (!file.includes('/node_modules/')) existingPaths.add(file);
    }
  }

  const markdownFiles: string[] = [];
  for (const pattern of ['README.md', 'docs/**/*.md', 'skills/redproof/**/*.md']) {
    for await (const file of glob(pattern, { cwd: root })) markdownFiles.push(file);
  }
  const markdown = await Promise.all([...new Set(markdownFiles)].sort().map(async file => ({
    file,
    content: await read(root, file),
  })));

  return {
    rootScripts: rootManifest.scripts ?? {},
    rootBuildScript: rootManifest.scripts?.build ?? '',
    manifests,
    setVersionSource: await read(root, 'scripts/set-version.ts'),
    verifyPackageSource: await read(root, 'scripts/verify-package.ts'),
    ciWorkflow: await read(root, '.github/workflows/ci.yml'),
    publishWorkflow: await read(root, '.github/workflows/publish.yml'),
    existingPaths,
    markdown,
  };
}

const gate = defineGate({
  id: 'repository-policy',
  rules,
  check: {
    description: 'evaluate package, release, public-surface, automation, and documentation contracts',
    counting: counting.supported,
    async run(ctx) {
      const startedAt = new Date().toISOString();
      try {
        const state = await snapshot(ctx.root);
        const findings = evaluateRepositoryPolicy(state);
        return result.fromBreaches({
          source: 'repository policy',
          startedAt,
          finishedAt: new Date().toISOString(),
          inspected: state.manifests.length + state.markdown.length,
        }, findings.map(finding => breach(ruleByFinding[finding.rule], {
          code: finding.code,
          message: finding.message,
          location: { file: finding.file, line: null, column: null },
          ...(finding.detail ? { detail: finding.detail } : {}),
        })));
      } catch (error) {
        return result.refuse({
          source: 'repository policy',
          startedAt,
          finishedAt: new Date().toISOString(),
          inspected: null,
        }, {
          code: 'repository-policy-unavailable',
          message: 'Repository policy inputs could not be read.',
          location: null,
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    },
  },
});

export const proofs = defineProofs(gate, [
  proof.red(
    rules.packageInventory,
    'detects a package omitted from a release inventory',
    mutate.replaceText(
      locate.text({ files: 'scripts/set-version.ts', find: "'packages/testing'," }),
      "'packages/testing-off',",
    ),
  ),
  proof.red(
    rules.versionAlignment,
    'detects divergent package versions',
    mutate.replaceText(
      locate.text({ files: 'packages/testing/package.json', find: '"version": "0.6.0"' }),
      '"version": "0.6.1"',
    ),
  ),
  proof.red(
    rules.publicFiles,
    'detects an undeclared public schema surface',
    mutate.replaceText(
      locate.text({ files: 'packages/redproof/package.json', find: '"schema"' }),
      '"schema-off"',
    ),
  ),
  proof.red(
    rules.automationVerification,
    'detects removed CI package verification',
    mutate.replaceText(
      locate.text({ files: '.github/workflows/ci.yml', find: 'run: npm run verify:package' }),
      'run: npm run verify:package-off',
    ),
  ),
  proof.red(
    rules.docsLinks,
    'detects a broken relative documentation link',
    mutate.createFile(
      'docs/redproof-broken-link-proof.md',
      '# Proof probe\n\n[missing document](./definitely-missing.md)\n',
    ),
  ),
  proof.green('accepts the current repository contracts'),
]);

export default gate;
