import assert from 'node:assert/strict';
import { readFile, rename, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { checkProject, loadProject, proveProject } from 'redproof';

const config = resolve('fixtures/eslint-project/redproof.config.ts');
const source = resolve('fixtures/eslint-project/src/clean.js');
const eslintConfig = resolve('fixtures/eslint-project/eslint.config.mjs');

async function snapshot() {
  return readFile(source, 'utf8');
}

test('defineConfig drives gate discovery relative to the fixture project', async () => {
  const project = await loadProject(config);
  assert.equal(project.root, resolve('fixtures/eslint-project'));
  assert.equal(project.refusalExit, 2);
  assert.equal(project.modules.length, 1);
  assert.equal(project.modules[0]?.gate.id, 'eslint');
});

test('clean ESLint gate passes', async () => {
  const run = await checkProject(config);
  assert.equal(run.exitCode, 0);
  assert.equal(run.results[0]?.result.verdict, 'pass');
});

test('fixture proves ESLint red, green, and refuse and restores mutations', async () => {
  const before = await snapshot();
  const run = await proveProject(config);

  assert.equal(run.exitCode, 0);
  assert.deepEqual(
    run.outcomes.map(outcome => [
      outcome.expected,
      outcome.ok,
      outcome.status === 'completed' ? outcome.result.verdict : outcome.error.code,
    ]),
    [
      ['red', true, 'fail'],
      ['red', true, 'fail'],
      ['green', true, 'pass'],
      ['refuse', true, 'refuse'],
    ],
  );

  assert.equal(await snapshot(), before);
  await stat(eslintConfig);
});


test('refusalExit controls the process status for a refused Gate', async () => {
  const hidden = resolve('fixtures/eslint-project/eslint.config.hidden.mjs');
  await rename(eslintConfig, hidden);

  try {
    const run = await checkProject(config);
    assert.equal(run.results[0]?.result.verdict, 'refuse');
    assert.equal(run.exitCode, 2);
  } finally {
    await rename(hidden, eslintConfig);
  }
});

test('gate description exposes rules, Check, and all proof expectations', async () => {
  const { describeProject, formatGateDescription } = await import('redproof');
  const run = await describeProject(config);
  const rendered = formatGateDescription(run.descriptions[0]!);

  assert.equal(rendered, `Gate: eslint

Rules:
  R1 ESLint rule no-console must hold.
  R2 ESLint rule eqeqeq must hold.

Check:
  run ESLint against src/**/*.js and report configured rule breaches

Proof R1:
  detects console usage
  mutation: append text to src/clean.js
  run the same Check
  expect Gate FAIL

Proof R2:
  detects loose equality
  mutation: append text to src/clean.js
  run the same Check
  expect Gate FAIL

Proof GREEN:
  accepts clean source
  run the same Check
  expect Gate PASS

Proof REFUSE:
  refuses when ESLint configuration is unavailable
  mutation: rename eslint.config.mjs to eslint.config.off.mjs
  run the same Check
  expect Gate REFUSE`);
});
