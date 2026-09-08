import { defineGate, defineProofs, defineRules, locate, mutate, proof } from 'redproof';
import { repositoryPolicy } from './checks/repository-policy.ts';

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

const gate = defineGate({
  id: 'repository-policy',
  rules,
  check: repositoryPolicy({
    rules,
    documents: ['README.md', 'docs/**/*.md', 'skills/redproof/**/*.md'],
    linkTargets: [
      'README.md',
      'LICENSE',
      '.github/**/*',
      'docs/**/*',
      'fixtures/**/*',
      'gates/**/*',
      'packages/**/*',
      'scripts/**/*',
      'skills/**/*',
    ],
  }),
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
      locate.text({ files: 'packages/testing/package.json', find: '"version": "0.10.0"' }),
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
  proof.refuse(
    'refuses when a policy input cannot be read',
    mutate.rename('.github/workflows/ci.yml', '.github/workflows/ci.off.yml'),
  ),
  proof.green('accepts the current repository contracts'),
]);

export default gate;
