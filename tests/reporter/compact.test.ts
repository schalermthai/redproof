import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { checkProject, formatCompactRun } from 'redproof';

test('compact reporter emits problem-matcher-friendly source diagnostics', async () => {
  const run = await checkProject(resolve('fixtures/fail-single/redproof.config.ts'));
  const output = formatCompactRun(run);
  assert.match(output, /^src\/parser\.ts:2:30: error redproof\[parser\/rejects-malformed-input\]: Malformed input was accepted\.$/m);
});

test('compact reporter emits refusal without pretending it is a Rule breach', async () => {
  const run = await checkProject(resolve('fixtures/refuse/redproof.config.ts'));
  const output = formatCompactRun(run);
  assert.match(output, /error redproof\[REFUSE:eslint\]: ESLint configuration could not be loaded\./);
  assert.doesNotMatch(output, /eslint\/no-console/);
});

test('compact reporter is silent for an all-pass run', async () => {
  const run = await checkProject(resolve('fixtures/pass-single/redproof.config.ts'));
  assert.equal(formatCompactRun(run), '');
});
