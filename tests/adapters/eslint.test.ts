import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { eslint } from '@redproof/eslint';
import { withWorkspace } from '../helpers/workspace.ts';

const FLAT_CONFIG = `export default [
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    rules: {},
  },
];
`;

async function write(root: string, file: string, content: string): Promise<void> {
  const path = join(root, file);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
}

const adapter = (files?: readonly string[]) => eslint({
  ...(files ? { files } : {}),
  rules: { noConsole: 'no-console', strictEquality: 'eqeqeq' },
});

const run = (root: string, files?: readonly string[]) => {
  const built = adapter(files);
  return built.check.run({
    root,
    rules: [built.rules.noConsole.id, built.rules.strictEquality.id],
  });
};

test('the adapter adopts each named ESLint rule under a Redproof Rule of its own', () => {
  const built = adapter(['src/**/*.js']);

  assert.equal(built.rules.noConsole.id, 'eslint/no-console');
  assert.equal(built.rules.strictEquality.id, 'eslint/eqeqeq');
  assert.equal(built.rules.noConsole.description, 'ESLint rule no-console must hold.');
  assert.equal(
    built.check.description,
    'run ESLint against src/**/*.js and report configured rule breaches',
  );
  assert.equal(
    eslint({ rules: { noConsole: 'no-console' } }).check.description,
    'run ESLint against . and report configured rule breaches',
  );
});

test('an ESLint finding becomes a Breach of the adopted Rule, at the file and position it was found', async () => {
  await withWorkspace(async root => {
    await write(root, 'eslint.config.mjs', FLAT_CONFIG);
    await write(root, 'src/noisy.js', 'export const value = 1;\nconsole.log(value);\n');

    const result = await run(root, ['src/**/*.js']);

    assert.equal(result.verdict, 'fail');
    if (result.verdict !== 'fail') return;
    assert.equal(result.breaches.length, 1);
    assert.equal(result.breaches[0]?.rule, 'eslint/no-console');
    assert.equal(result.breaches[0]?.code, 'no-console');
    assert.deepEqual(result.breaches[0]?.location, {
      file: 'src/noisy.js',
      line: 2,
      column: 1,
    });
  });
});

test('one run reports breaches of every adopted Rule, and clean source passes', async () => {
  await withWorkspace(async root => {
    await write(root, 'eslint.config.mjs', FLAT_CONFIG);
    await write(root, 'src/noisy.js', 'console.log(1);\n');
    await write(root, 'src/loose.js', 'export const same = (a, b) => a == b;\n');

    const failed = await run(root, ['src/**/*.js']);
    assert.equal(failed.verdict, 'fail');
    if (failed.verdict !== 'fail') return;
    assert.deepEqual(new Set(failed.breaches.map(item => item.rule)), new Set([
      'eslint/no-console',
      'eslint/eqeqeq',
    ]));

    await write(root, 'src/noisy.js', 'export const value = 1;\n');
    await write(root, 'src/loose.js', 'export const same = (a, b) => a === b;\n');
    assert.equal((await run(root, ['src/**/*.js'])).verdict, 'pass');
  });
});

test('an ESLint finding the Gate did not adopt is not a Breach of anything', async () => {
  await withWorkspace(async root => {
    await write(root, 'eslint.config.mjs', `export default [
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    rules: { 'no-var': 'error' },
  },
];
`);
    await write(root, 'src/legacy.js', 'var value = 1;\nexport { value };\n');

    const result = await run(root, ['src/**/*.js']);

    assert.equal(result.verdict, 'pass', 'no-var was never adopted as a Redproof Rule');
  });
});

test('the inspection count is the number of files ESLint linted, not the number of findings', async () => {
  await withWorkspace(async root => {
    await write(root, 'eslint.config.mjs', FLAT_CONFIG);
    await write(root, 'src/a.js', 'console.log(1);\nconsole.log(2);\n');
    await write(root, 'src/b.js', 'export const b = 1;\n');
    await write(root, 'src/c.js', 'export const c = 1;\n');

    const result = await run(root, ['src/**/*.js']);

    assert.equal(result.scan.inspected, 3);
    assert.equal(result.verdict, 'fail');
    if (result.verdict !== 'fail') return;
    assert.equal(result.breaches.length, 2);
  });
});

test('only the configured files are linted', async () => {
  await withWorkspace(async root => {
    await write(root, 'eslint.config.mjs', FLAT_CONFIG);
    await write(root, 'src/clean.js', 'export const value = 1;\n');
    await write(root, 'scripts/noisy.js', 'console.log(1);\n');

    const result = await run(root, ['src/**/*.js']);

    assert.equal(result.verdict, 'pass');
    assert.equal(result.scan.inspected, 1);
  });
});

test('a file ESLint cannot parse REFUSES the Gate instead of inventing a Rule breach', async () => {
  await withWorkspace(async root => {
    await write(root, 'eslint.config.mjs', FLAT_CONFIG);
    await write(root, 'src/broken.js', 'export const value = ;\n');
    await write(root, 'src/noisy.js', 'console.log(1);\n');

    const result = await run(root, ['src/**/*.js']);

    assert.equal(result.verdict, 'refuse');
    if (result.verdict !== 'refuse') return;
    assert.equal(result.why.location?.file, 'src/broken.js');
    assert.equal(result.why.code, 'eslint-fatal');
  });
});

test('an ESLint that cannot run at all REFUSES with no inspection count', async () => {
  await withWorkspace(async root => {
    await write(root, 'src/clean.js', 'export const value = 1;\n');

    const result = await run(root, ['src/**/*.js']);

    assert.equal(result.verdict, 'refuse');
    if (result.verdict !== 'refuse') return;
    assert.equal(result.why.code, 'eslint-unavailable');
    assert.equal(result.scan.inspected, null);
    assert.equal(typeof result.why.detail, 'string');
  });
});
