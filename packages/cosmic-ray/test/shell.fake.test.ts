import assert from 'node:assert/strict';
import test from 'node:test';
import type { CommandExecution, CommandExecutionOptions } from 'redproof/command';
import { createCosmicRayAdapter } from '../src/shell/adapter.ts';
import { dumpText, type FixtureName } from './support/fixtures.ts';
import { withWorkspace } from './support/workspace.ts';

const done = (stdout = '', exitCode = 0): CommandExecution => ({ kind: 'completed', exitCode, stdout, stderr: '' });

/** Scripted cosmic-ray: each step answers from `plan`, and every call is recorded. */
function fake(plan: Partial<Record<string, CommandExecution>>, dump: FixtureName = 'survivors') {
  const calls: CommandExecutionOptions[] = [];
  const run = async (options: CommandExecutionOptions) => {
    calls.push(options);
    const step = options.args?.[2] ?? '';
    return plan[step] ?? done(step === 'dump' ? dumpText(dump) : '');
  };
  return { calls, run };
}

const rules = { mutantsDetected: true, mutationScore: { minimum: 90 } } as const;

test('runs baseline, init, exec and dump in order, in the working directory', () => withWorkspace(async root => {
  const { calls, run } = fake({});
  const adapter = createCosmicRayAdapter({ rules, cwd: '.', config: 'c.toml', python: 'py' }, run);
  const verdict = await adapter.check.run({ root, rules: ['cosmic-ray/mutants-detected', 'cosmic-ray/mutation-score'] });
  assert.equal(verdict.verdict, 'fail');
  assert.deepEqual(calls.map(call => call.args?.[2]), ['baseline', 'init', 'exec', 'dump']);
  assert.ok(calls.every(call => call.command === 'py'));
  assert.deepEqual(calls[0]?.args, ['-m', 'cosmic_ray.cli', 'baseline', 'c.toml']);
}));

test('a failing baseline refuses before any mutant is judged', () => withWorkspace(async root => {
  const { calls, run } = fake({ baseline: done('', 1) });
  const adapter = createCosmicRayAdapter({ rules }, run);
  const verdict = await adapter.check.run({ root, rules: ['cosmic-ray/mutants-detected'] });
  assert.equal(verdict.verdict === 'refuse' && verdict.why.code, 'cosmic-ray-baseline-failed');
  assert.equal(calls.length, 1);
}));

test('a failing exec refuses', () => withWorkspace(async root => {
  const adapter = createCosmicRayAdapter({ rules }, fake({ exec: done('', 3) }).run);
  const verdict = await adapter.check.run({ root, rules: ['cosmic-ray/mutants-detected'] });
  assert.equal(verdict.verdict === 'refuse' && verdict.why.code, 'cosmic-ray-producer-unsuccessful');
}));

test('a command that could not start or timed out refuses with its own code', () => withWorkspace(async root => {
  const refused: CommandExecution = { kind: 'refused', code: 'command-timeout', message: 'too slow' };
  const adapter = createCosmicRayAdapter({ rules }, fake({ exec: refused }).run);
  const verdict = await adapter.check.run({ root, rules: ['cosmic-ray/mutants-detected'] });
  assert.equal(verdict.verdict === 'refuse' && verdict.why.code, 'command-timeout');
}));

test('an unreadable dump refuses', () => withWorkspace(async root => {
  const adapter = createCosmicRayAdapter({ rules }, fake({ dump: done('garbage') }).run);
  const verdict = await adapter.check.run({ root, rules: ['cosmic-ray/mutants-detected'] });
  assert.equal(verdict.verdict === 'refuse' && verdict.why.code, 'cosmic-ray-report-invalid');
}));

test('a timed-out dump refuses even for a score rule that would otherwise pass', () => withWorkspace(async root => {
  const adapter = createCosmicRayAdapter({ rules: { mutationScore: { minimum: 0 } } }, fake({}, 'timeout').run);
  const verdict = await adapter.check.run({ root, rules: ['cosmic-ray/mutation-score'] });
  assert.equal(verdict.verdict === 'refuse' && verdict.why.code, 'cosmic-ray-incomplete');
}));

test('a killed exec (exit 137) refuses even though a partial dump would pass', () => withWorkspace(async root => {
  const adapter = createCosmicRayAdapter({ rules }, fake({ exec: done('', 137) }, 'all-killed').run);
  const verdict = await adapter.check.run({ root, rules: ['cosmic-ray/mutants-detected'] });
  assert.equal(verdict.verdict === 'refuse' && verdict.why.code, 'cosmic-ray-producer-unsuccessful');
}));

test('a signalled dump refuses', () => withWorkspace(async root => {
  const signalled: CommandExecution = { kind: 'refused', code: 'command-signaled', message: 'killed' };
  const adapter = createCosmicRayAdapter({ rules }, fake({ dump: signalled }).run);
  const verdict = await adapter.check.run({ root, rules: ['cosmic-ray/mutation-score'] });
  assert.equal(verdict.verdict === 'refuse' && verdict.why.code, 'command-signaled');
}));

test('an empty dump (zero mutants) refuses for each rule alone', () => withWorkspace(async root => {
  const a = createCosmicRayAdapter({ rules: { mutantsDetected: true } }, fake({ dump: done('') }).run);
  const b = createCosmicRayAdapter({ rules: { mutationScore: { minimum: 0 } } }, fake({ dump: done('') }).run);
  for (const verdict of [await a.check.run({ root, rules: ['cosmic-ray/mutants-detected'] }), await b.check.run({ root, rules: ['cosmic-ray/mutation-score'] })]) {
    assert.equal(verdict.verdict === 'refuse' && verdict.why.code, 'cosmic-ray-no-mutants');
  }
}));
