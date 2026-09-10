import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateRepositoryPolicy,
  type ManifestSnapshot,
  type RepositoryPolicyFinding,
  type RepositorySnapshot,
} from '../../gates/support/repository-policy-model.ts';

const workflow = [
  'run: npm run check',
  'run: npm run build',
  'run: npm run verify:package',
].join('\n');

function manifest(name: string, dir: string, version = '1.0.0', extra: Partial<ManifestSnapshot['manifest']> = {}): ManifestSnapshot {
  return {
    file: `${dir}/package.json`,
    dir,
    name,
    version,
    manifest: {
      types: './dist/index.d.ts',
      files: ['dist', 'schema'],
      exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
      ...extra,
    },
  };
}

function snapshot(overrides: Partial<RepositorySnapshot> = {}): RepositorySnapshot {
  return {
    rootScripts: {
      build: 'tsc -p packages/redproof/tsconfig.build.json',
      check: 'npm run self:check && npm run self:prove',
      'self:check': 'redproof check',
      'self:prove': 'redproof prove',
    },
    rootBuildScript: 'tsc -p packages/redproof/tsconfig.build.json',
    manifests: [manifest('redproof', 'packages/redproof')],
    setVersionSource: "const dirs = ['packages/redproof'];",
    verifyPackageSource: "const packages = [{ name: 'redproof' }];",
    ciWorkflow: workflow,
    publishWorkflow: [workflow, 'npm pack -w redproof', 'for PKG in redproof; do'].join('\n'),
    existingPaths: new Set([
      'README.md',
      'docs/guide.md',
      'packages/redproof/src/index.ts',
      'packages/redproof/schema/check-report-v1.schema.json',
      'packages/redproof/schema/prove-report-v1.schema.json',
    ]),
    markdown: [{ file: 'README.md', content: '[guide](docs/guide.md)\n' }],
    ...overrides,
  };
}

const codes = (findings: readonly RepositoryPolicyFinding[]) => findings.map(item => item.code);

test('repository policy accepts a complete value snapshot', () => {
  assert.deepEqual(evaluateRepositoryPolicy(snapshot()), []);
});

test('a package missing from any release stage is reported once per stage, against that stage file', () => {
  const clean = snapshot();
  const findings = evaluateRepositoryPolicy({
    ...clean,
    manifests: [...clean.manifests, manifest('@redproof/extra', 'packages/extra')],
  });

  assert.deepEqual(findings.map(item => [item.rule, item.code, item.file, item.message]), [
    ['packageInventory', 'package-missing-from-release-stage', 'package.json', '@redproof/extra is missing from the root build script.'],
    ['packageInventory', 'package-missing-from-release-stage', 'scripts/set-version.ts', '@redproof/extra is missing from the version setter.'],
    ['packageInventory', 'package-missing-from-release-stage', 'scripts/verify-package.ts', '@redproof/extra is missing from the package verifier.'],
    ['packageInventory', 'package-missing-from-release-stage', '.github/workflows/publish.yml', '@redproof/extra is missing from the tarball build.'],
    ['packageInventory', 'package-missing-from-release-stage', '.github/workflows/publish.yml', '@redproof/extra is missing from the publish loop.'],
    ['publicFiles', 'invalid-package-entrypoint', 'packages/extra/package.json', '@redproof/extra must declare matching runtime and type entrypoints backed by source.'],
  ]);
});

test('a second package is accepted once every release stage names it', () => {
  const clean = snapshot();
  const findings = evaluateRepositoryPolicy({
    ...clean,
    manifests: [...clean.manifests, manifest('@redproof/extra', 'packages/extra')],
    rootBuildScript: 'tsc -p packages/redproof/tsconfig.build.json && tsc -p packages/extra/tsconfig.build.json',
    setVersionSource: 'const dirs = ["packages/redproof", "packages/extra"];',
    verifyPackageSource: "const packages = [{ name: 'redproof' }, { name: \"@redproof/extra\" }];",
    publishWorkflow: [workflow, 'npm pack -w redproof \\', '  -w @redproof/extra', 'for PKG in redproof @redproof/extra; do'].join('\n'),
    existingPaths: new Set([...clean.existingPaths, 'packages/extra/src/index.ts']),
  });

  assert.deepEqual(findings, []);
});

test('publishable packages must share one version, and every internal dependency section must pin it', () => {
  const clean = snapshot();
  const findings = evaluateRepositoryPolicy({
    ...clean,
    manifests: [
      manifest('redproof', 'packages/redproof', '2.0.0'),
      manifest('@redproof/extra', 'packages/extra', '1.0.0', { dependencies: { redproof: '2.0.0' } }),
    ],
  });

  assert.deepEqual(
    findings.filter(item => item.rule === 'versionAlignment').map(item => [item.code, item.file, item.detail ?? item.message]),
    [
      ['package-versions-diverge', 'packages', '1.0.0, 2.0.0'],
      ['internal-version-diverges', 'packages/extra/package.json', '@redproof/extra pins redproof@2.0.0 in dependencies instead of 1.0.0.'],
    ],
  );
});

test('development and peer links between publishable packages must pin the shared version', () => {
  const clean = snapshot();
  const findings = evaluateRepositoryPolicy({
    ...clean,
    manifests: [
      manifest('redproof', 'packages/redproof'),
      manifest('@redproof/adapter-tck', 'packages/adapter-tck', '1.0.0', {
        peerDependencies: { redproof: '0.9.0' },
      }),
      manifest('@redproof/extra', 'packages/extra', '1.0.0', {
        devDependencies: { '@redproof/adapter-tck': '0.9.0' },
      }),
    ],
  });

  assert.deepEqual(
    findings.filter(item => item.rule === 'versionAlignment').map(item => item.message),
    [
      '@redproof/adapter-tck pins redproof@0.9.0 in peerDependencies instead of 1.0.0.',
      '@redproof/extra pins @redproof/adapter-tck@0.9.0 in devDependencies instead of 1.0.0.',
    ],
  );
});

test('internal package dependencies must follow the declared package layers', () => {
  const clean = snapshot();
  const findings = evaluateRepositoryPolicy({
    ...clean,
    manifests: [
      manifest('redproof', 'packages/redproof', '1.0.0', {
        dependencies: { '@redproof/adapter-tck': '1.0.0' },
      }),
      manifest('@redproof/adapter-tck', 'packages/adapter-tck', '1.0.0', {
        peerDependencies: { redproof: '1.0.0' },
      }),
      manifest('@redproof/example', 'packages/example', '1.0.0', {
        dependencies: { redproof: '1.0.0', '@redproof/adapter-tck': '1.0.0' },
        devDependencies: { '@redproof/adapter-tck': '1.0.0' },
      }),
    ],
  });

  assert.deepEqual(
    findings
      .filter(item => item.code === 'internal-package-boundary-violated')
      .map(item => [item.file, item.message]),
    [
      [
        'packages/redproof/package.json',
        'redproof must not depend on @redproof/adapter-tck through dependencies.',
      ],
      [
        'packages/example/package.json',
        '@redproof/example may use @redproof/adapter-tck only through devDependencies.',
      ],
    ],
  );
});

test('a package entrypoint must match on types, runtime, files, and source', () => {
  const broken = (extra: Partial<ManifestSnapshot['manifest']>) =>
    codes(evaluateRepositoryPolicy(snapshot({ manifests: [manifest('redproof', 'packages/redproof', '1.0.0', extra)] })));

  assert.deepEqual(broken({ types: './dist/main.d.ts' }), ['invalid-package-entrypoint']);
  assert.deepEqual(broken({ exports: { '.': { types: './dist/index.d.ts', default: './dist/main.js' } } }), ['invalid-package-entrypoint']);
  assert.deepEqual(broken({ exports: { '.': './dist/index.js' } }), ['invalid-package-entrypoint']);
  assert.deepEqual(broken({ files: ['schema'] }), ['invalid-package-entrypoint']);

  const clean = snapshot();
  const withoutSource = new Set([...clean.existingPaths].filter(path => path !== 'packages/redproof/src/index.ts'));
  assert.deepEqual(codes(evaluateRepositoryPolicy({ ...clean, existingPaths: withoutSource })), ['invalid-package-entrypoint']);
});

test('a subpath export and a binary must point at dist files backed by source', () => {
  const clean = snapshot();
  const exports = {
    '.': { types: './dist/index.d.ts', default: './dist/index.js' },
    './command': { types: './dist/command/index.d.ts', default: './dist/command/index.js' },
    './missing': { types: './dist/missing.d.ts', default: './dist/missing.js' },
    './runtime-only': './dist/index.js',
  };
  const findings = evaluateRepositoryPolicy({
    ...clean,
    manifests: [manifest('redproof', 'packages/redproof', '1.0.0', { exports, bin: { redproof: './dist/cli.js', other: './dist/absent.js' } })],
    existingPaths: new Set([...clean.existingPaths, 'packages/redproof/src/command/index.ts', 'packages/redproof/src/cli.ts']),
  });

  assert.deepEqual(findings.map(item => [item.code, item.message]), [
    ['invalid-package-subpath', 'redproof export ./missing has no source-backed types target.'],
    ['invalid-package-subpath', 'redproof export ./missing has no source-backed default target.'],
    ['invalid-package-subpath', 'redproof export ./runtime-only has no source-backed types target.'],
    ['invalid-package-bin', 'redproof binary other has no source-backed target.'],
  ]);
});

test('the core package must ship both public report schemas', () => {
  const clean = snapshot();

  assert.deepEqual(
    codes(evaluateRepositoryPolicy({ ...clean, manifests: [manifest('redproof', 'packages/redproof', '1.0.0', { files: ['dist'] })] })),
    ['public-schema-missing'],
  );
  const withoutSchema = new Set([...clean.existingPaths].filter(path => !path.endsWith('prove-report-v1.schema.json')));
  assert.deepEqual(codes(evaluateRepositoryPolicy({ ...clean, existingPaths: withoutSchema })), ['public-schema-missing']);
});

test('the root check script must run both self-verification scripts', () => {
  const clean = snapshot();

  const noProve = { ...clean.rootScripts };
  delete (noProve as Record<string, string>)['self:prove'];
  assert.deepEqual(
    evaluateRepositoryPolicy({ ...clean, rootScripts: noProve }).map(item => [item.code, item.message]),
    [['self-verification-not-enforced', 'The root check must invoke the self proof script.']],
  );

  const notInvoked = { ...clean.rootScripts, check: 'npm run self:prove' };
  assert.deepEqual(
    evaluateRepositoryPolicy({ ...clean, rootScripts: notInvoked }).map(item => item.message),
    ['The root check must invoke the self check script.'],
  );
});

test('each workflow must keep every verification command as an exact step', () => {
  const clean = snapshot();

  const drifted = evaluateRepositoryPolicy({
    ...clean,
    ciWorkflow: clean.ciWorkflow.replace('run: npm run verify:package', 'run: npm run verify:package-off'),
  });
  assert.deepEqual(drifted.map(item => [item.code, item.file, item.message]), [
    ['workflow-verification-missing', '.github/workflows/ci.yml', '.github/workflows/ci.yml must retain npm run verify:package.'],
  ]);

  const publishWithoutBuild = evaluateRepositoryPolicy({
    ...clean,
    publishWorkflow: clean.publishWorkflow.replace('run: npm run build\n', ''),
  });
  assert.deepEqual(publishWithoutBuild.map(item => [item.file, item.message]), [
    ['.github/workflows/publish.yml', '.github/workflows/publish.yml must retain npm run build.'],
  ]);

  const indented = evaluateRepositoryPolicy({ ...clean, ciWorkflow: clean.ciWorkflow.replace(/^/gm, '        ') });
  assert.deepEqual(indented, [], 'YAML indentation does not change the step');
});

test('a relative documentation link must resolve to a file or a directory', () => {
  const clean = snapshot();
  const findings = evaluateRepositoryPolicy({
    ...clean,
    markdown: [
      {
        file: 'docs/guide.md',
        content: [
          '[sibling](guide.md#anchor)',
          '[up](../README.md?raw=1)',
          '[missing](missing.md)',
          '[dir](../docs)',
          '[dir slash](../docs/)',
          '![image](<img.png>)',
          '[web](https://example.com/x.md)',
          '[mail](mailto:a@b.c)',
          '[absolute](/etc/passwd)',
          '[anchor](#top)',
          '[ref]: other.md',
          '[encoded](../my%20doc.md)',
        ].join('\n'),
      },
    ],
    existingPaths: new Set([...clean.existingPaths, 'my doc.md']),
  });

  assert.deepEqual(findings.map(item => [item.code, item.file, item.message, item.detail]), [
    ['broken-relative-doc-link', 'docs/guide.md', 'docs/guide.md points to missing docs/missing.md.', 'missing.md'],
    ['broken-relative-doc-link', 'docs/guide.md', 'docs/guide.md points to missing docs/img.png.', '<img.png>'],
    ['broken-relative-doc-link', 'docs/guide.md', 'docs/guide.md points to missing docs/other.md.', 'other.md'],
  ]);
});

test('findings are grouped by policy in a fixed order', () => {
  const clean = snapshot();
  const findings = evaluateRepositoryPolicy({
    ...clean,
    rootScripts: { ...clean.rootScripts, check: 'npm run self:check' },
    manifests: [manifest('redproof', 'packages/redproof', '1.0.0', { files: ['dist'] })],
    markdown: [{ file: 'README.md', content: '[gone](gone.md)\n' }],
    setVersionSource: '',
  });

  assert.deepEqual(findings.map(item => item.rule), ['packageInventory', 'publicFiles', 'automationVerification', 'docsLinks']);
});
