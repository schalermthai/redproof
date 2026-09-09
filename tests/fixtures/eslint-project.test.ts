import assert from 'node:assert/strict';
import { readFile, rename, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  checkProject,
  describeProject,
  formatGateDescription,
  loadProject,
  proveProject,
} from 'redproof';
import { configOf, proofSummary } from './project.ts';

/**
 * The ESLint fixture runs in-place, so a proof run really mutates and restores
 * the fixture tree. That is what this file proves that a temporary workspace
 * cannot: real ESLint, the whole check-prove-describe cycle, and a fixture tree
 * that is byte-identical afterwards.
 */
const config = configOf('eslint-project');
const source = resolve('fixtures/eslint-project/src/clean.js');
const eslintConfig = resolve('fixtures/eslint-project/eslint.config.mjs');

const snapshot = () => readFile(source, 'utf8');

test('the fixture configuration decides where Gates are discovered and how a refusal exits', async () => {
  const project = await loadProject(config);

  assert.equal(project.root, resolve('fixtures/eslint-project'));
  assert.equal(project.refusalExit, 2);
  assert.equal(project.modules.length, 1);
  assert.equal(project.modules[0]?.gate.id, 'eslint');
});

test('the clean fixture source passes the ESLint Gate, with every file counted as inspected', async () => {
  const run = await checkProject(config);

  assert.equal(run.exitCode, 0);
  assert.equal(run.results[0]?.result.verdict, 'pass');
  assert.equal(run.results[0]?.result.scan.inspected, 1);
});

test('the fixture proves each ESLint Rule red, the clean source green, and a broken setup refused', async () => {
  const run = await proveProject(config);

  assert.equal(run.exitCode, 0);
  assert.deepEqual(proofSummary(run), [
    ['red', true, 'fail'],
    ['red', true, 'fail'],
    ['green', true, 'pass'],
    ['refuse', true, 'refuse'],
  ]);
});

test('a proof run leaves the fixture tree exactly as it found it', async () => {
  const before = await snapshot();

  await proveProject(config);

  assert.equal(await snapshot(), before);
  await stat(eslintConfig);
});

test('a refused Gate exits with the status the project configured for refusals', async () => {
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

test('the Gate describes its Rules, its Check, and every proof without running anything', async () => {
  const run = await describeProject(config);

  assert.equal(formatGateDescription(run.descriptions[0]!), `Gate: eslint

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
