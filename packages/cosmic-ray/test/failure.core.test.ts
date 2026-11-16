import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyStepFailure } from '../src/core/failure.ts';

const code = (step: Parameters<typeof classifyStepFailure>[0], exit: number, stdout = '', stderr = '') =>
  classifyStepFailure(step, exit, stdout, stderr).code;

test('a missing cosmic_ray module is not a failing suite, whatever the step or exit code', () => {
  for (const step of ['baseline', 'init', 'exec', 'dump'] as const) {
    assert.equal(code(step, 1, '', "No module named 'cosmic_ray'"), 'cosmic-ray-not-installed');
    assert.equal(code(step, 1, '', 'No module named cosmic_ray.cli'), 'cosmic-ray-not-installed');
  }
});

test('exit 78 is a configuration problem', () => {
  assert.equal(code('baseline', 78), 'cosmic-ray-config-invalid');
  assert.equal(code('init', 78, '', 'ConfigError'), 'cosmic-ray-config-invalid');
});

test('only a baseline exit 1 with the "Baseline failed" text blames the tests', () => {
  assert.equal(code('baseline', 1, '', 'ERROR:root:Baseline failed. Execution with no mutation'), 'cosmic-ray-baseline-failed');
  assert.equal(code('baseline', 1, '', 'something else broke'), 'cosmic-ray-producer-unsuccessful');
  assert.equal(code('baseline', 3, '', 'Baseline failed'), 'cosmic-ray-producer-unsuccessful');
  assert.equal(code('exec', 1, '', 'Baseline failed'), 'cosmic-ray-producer-unsuccessful');
});

test('every other failure is a producer failure carrying the output', () => {
  const failure = classifyStepFailure('exec', 137, 'out', 'err');
  assert.equal(failure.code, 'cosmic-ray-producer-unsuccessful');
  assert.match(failure.detail ?? '', /exit code: 137[\s\S]*err[\s\S]*out/u);
});

test('a baseline whose tests were signalled or could not start is not blamed on the assertions', () => {
  assert.equal(code('baseline', 1, '', 'ERROR:root:Baseline failed.\n  >>> REDPROOF-SIGNALLED -9'), 'cosmic-ray-baseline-unrunnable');
  assert.equal(code('baseline', 1, '', 'Baseline failed. REDPROOF-UNSTARTED Traceback'), 'cosmic-ray-baseline-unrunnable');
  assert.equal(code('exec', 1, '', 'REDPROOF-SIGNALLED -9'), 'cosmic-ray-producer-unsuccessful');
});

test('a baseline that ran past the timeout is named a timeout, not blamed on the assertions', () => {
  assert.equal(code('baseline', 1, '', 'ERROR:root:Baseline failed. Execution with no mutation gives those following results:\n  >>> timeout'), 'cosmic-ray-baseline-timeout');
  assert.equal(code('baseline', 1, '', 'Baseline failed.\n  >>> REDPROOF-EXIT 1\ntimeout handling is broken'), 'cosmic-ray-baseline-failed');
});
