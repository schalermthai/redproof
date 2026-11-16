import assert from 'node:assert/strict';
import test from 'node:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { realpath } from 'node:fs/promises';
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
  assert.deepEqual(calls.map(call => call.args?.[2]), ['baseline', 'init', 'dump', 'exec', 'dump']);
  assert.ok(calls.every(call => call.command === 'py'));
  assert.deepEqual(calls[0]?.args, ['-m', 'cosmic_ray.cli', 'baseline', 'c.toml']);
}));

test('a failing baseline refuses before any mutant is judged', () => withWorkspace(async root => {
  const { calls, run } = fake({ baseline: { kind: 'completed', exitCode: 1, stdout: '', stderr: 'ERROR:root:Baseline failed. Execution with no mutation gives those following errors:' } });
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

test('an all-timeout dump refuses (the cosmic-ray timeout is too short) even for a score rule', () => withWorkspace(async root => {
  const adapter = createCosmicRayAdapter({ rules: { mutationScore: { minimum: 1 } } }, fake({}, 'timeout').run);
  const verdict = await adapter.check.run({ root, rules: ['cosmic-ray/mutation-score'] });
  assert.equal(verdict.verdict === 'refuse' && verdict.why.code, 'cosmic-ray-timeouts-excessive');
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
  const b = createCosmicRayAdapter({ rules: { mutationScore: { minimum: 1 } } }, fake({ dump: done('') }).run);
  for (const verdict of [await a.check.run({ root, rules: ['cosmic-ray/mutants-detected'] }), await b.check.run({ root, rules: ['cosmic-ray/mutation-score'] })]) {
    assert.equal(verdict.verdict === 'refuse' && verdict.why.code, 'cosmic-ray-no-mutants');
  }
}));

test('a missing cosmic_ray module is not reported as a failing suite', () => withWorkspace(async root => {
  const missing: CommandExecution = { kind: 'completed', exitCode: 1, stdout: '', stderr: "No module named 'cosmic_ray'" };
  const adapter = createCosmicRayAdapter({ rules }, fake({ baseline: missing }).run);
  const verdict = await adapter.check.run({ root, rules: ['cosmic-ray/mutants-detected'] });
  assert.equal(verdict.verdict === 'refuse' && verdict.why.code, 'cosmic-ray-not-installed');
}));

test('a bad config (exit 78) is named as such, and an unexplained baseline exit is not a failing suite', () => withWorkspace(async root => {
  const config: CommandExecution = { kind: 'completed', exitCode: 78, stdout: '', stderr: 'ConfigError' };
  const odd: CommandExecution = { kind: 'completed', exitCode: 3, stdout: '', stderr: 'boom' };
  const bare: CommandExecution = { kind: 'completed', exitCode: 1, stdout: '', stderr: 'something else broke' };
  const c = createCosmicRayAdapter({ rules }, fake({ baseline: bare }).run);
  const three = await c.check.run({ root, rules: ['cosmic-ray/mutants-detected'] });
  assert.equal(three.verdict === 'refuse' && three.why.code, 'cosmic-ray-producer-unsuccessful');
  const a = createCosmicRayAdapter({ rules }, fake({ baseline: config }).run);
  const b = createCosmicRayAdapter({ rules }, fake({ baseline: odd }).run);
  const one = await a.check.run({ root, rules: ['cosmic-ray/mutants-detected'] });
  const two = await b.check.run({ root, rules: ['cosmic-ray/mutants-detected'] });
  assert.equal(one.verdict === 'refuse' && one.why.code, 'cosmic-ray-config-invalid');
  assert.equal(two.verdict === 'refuse' && two.why.code, 'cosmic-ray-producer-unsuccessful');
}));

test('a module path outside the working directory refuses BEFORE exec runs', () => withWorkspace(async root => {
  const escaping = dumpText('all-killed').replaceAll('"module_path": "mod.py"', '"module_path": "/etc/mod.py"');
  const { calls, run } = fake({ dump: done(escaping) });
  const adapter = createCosmicRayAdapter({ rules }, run);
  const verdict = await adapter.check.run({ root, rules: ['cosmic-ray/mutants-detected'] });
  assert.equal(verdict.verdict === 'refuse' && verdict.why.code, 'cosmic-ray-module-path-escapes');
  assert.ok(!calls.some(call => call.args?.[2] === 'exec'));
}));

test('every step runs in a sandbox copy, never in the project itself', () => withWorkspace(async root => {
  const { calls, run } = fake({});
  const adapter = createCosmicRayAdapter({ rules }, run);
  await adapter.check.run({ root, rules: ['cosmic-ray/mutants-detected'] });
  const real = await realpath(root);
  assert.ok(calls.length > 0 && calls.every(call => call.cwd !== real && !call.cwd.startsWith(`${real}/`)));
}));

test('a project over maxCopyBytes refuses before any step runs', () => withWorkspace(async root => {
  await writeFile(join(root, 'big.txt'), 'x'.repeat(2000));
  const { calls, run } = fake({});
  const adapter = createCosmicRayAdapter({ rules, maxCopyBytes: 1000 }, run);
  const verdict = await adapter.check.run({ root, rules: ['cosmic-ray/mutants-detected'] });
  assert.equal(verdict.verdict === 'refuse' && verdict.why.code, 'cosmic-ray-copy-too-large');
  assert.equal(calls.length, 0);
}));
