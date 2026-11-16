import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { realpath } from 'node:fs/promises';
import type { CommandExecution, CommandExecutionOptions } from 'redproof/command';
import { createCosmicRayAdapter } from '../src/shell/adapter.ts';
import type { RunEffects } from '../src/shell/run.ts';
import { dumpText, type FixtureName } from './support/fixtures.ts';
import { withWorkspace } from './support/workspace.ts';

/** The planned module must exist in the sandbox, as it does for real cosmic-ray. */
function withProject<T>(fn: (root: string) => Promise<T>): Promise<T> {
  return withWorkspace(async root => {
    await writeFile(join(root, 'mod.py'), 'def add(a, b):\n    return a + b\n');
    return fn(root);
  });
}

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

test('runs baseline, init, exec and dump in order, in the working directory', () => withProject(async root => {
  const { calls, run } = fake({});
  const adapter = createCosmicRayAdapter({ rules, cwd: '.', config: 'c.toml', python: 'py' }, run);
  const verdict = await adapter.check.run({ root, rules: ['cosmic-ray/mutants-detected', 'cosmic-ray/mutation-score'] });
  assert.equal(verdict.verdict, 'fail');
  assert.deepEqual(calls.map(call => call.args?.[2]), ['baseline', 'init', 'dump', 'exec', 'dump']);
  assert.ok(calls.every(call => call.command === 'py'));
  assert.deepEqual(calls[0]?.args?.slice(0, 1).concat(calls[0]?.args?.slice(2) ?? []), ['-c', 'baseline', 'c.toml']);
  assert.match(calls[0]?.args?.[1] ?? '', /cosmic_ray\.mutating[\s\S]*REDPROOF-EXIT/u);
}));

test('a failing baseline refuses before any mutant is judged', () => withProject(async root => {
  const { calls, run } = fake({ baseline: { kind: 'completed', exitCode: 1, stdout: '', stderr: 'ERROR:root:Baseline failed. Execution with no mutation gives those following errors:' } });
  const adapter = createCosmicRayAdapter({ rules }, run);
  const verdict = await adapter.check.run({ root, rules: ['cosmic-ray/mutants-detected'] });
  assert.equal(verdict.verdict === 'refuse' && verdict.why.code, 'cosmic-ray-baseline-failed');
  assert.equal(calls.length, 1);
}));

test('a failing exec refuses', () => withProject(async root => {
  const adapter = createCosmicRayAdapter({ rules }, fake({ exec: done('', 3) }).run);
  const verdict = await adapter.check.run({ root, rules: ['cosmic-ray/mutants-detected'] });
  assert.equal(verdict.verdict === 'refuse' && verdict.why.code, 'cosmic-ray-producer-unsuccessful');
}));

test('a command that could not start or timed out refuses with its own code', () => withProject(async root => {
  const refused: CommandExecution = { kind: 'refused', code: 'command-timeout', message: 'too slow' };
  const adapter = createCosmicRayAdapter({ rules }, fake({ exec: refused }).run);
  const verdict = await adapter.check.run({ root, rules: ['cosmic-ray/mutants-detected'] });
  assert.equal(verdict.verdict === 'refuse' && verdict.why.code, 'command-timeout');
}));

test('an unreadable dump refuses', () => withProject(async root => {
  const adapter = createCosmicRayAdapter({ rules }, fake({ dump: done('garbage') }).run);
  const verdict = await adapter.check.run({ root, rules: ['cosmic-ray/mutants-detected'] });
  assert.equal(verdict.verdict === 'refuse' && verdict.why.code, 'cosmic-ray-report-invalid');
}));

test('an all-timeout dump refuses (the cosmic-ray timeout is too short) even for a score rule', () => withProject(async root => {
  const adapter = createCosmicRayAdapter({ rules: { mutationScore: { minimum: 1 } } }, fake({}, 'timeout').run);
  const verdict = await adapter.check.run({ root, rules: ['cosmic-ray/mutation-score'] });
  assert.equal(verdict.verdict === 'refuse' && verdict.why.code, 'cosmic-ray-timeouts-excessive');
}));

test('a killed exec (exit 137) refuses even though a partial dump would pass', () => withProject(async root => {
  const adapter = createCosmicRayAdapter({ rules }, fake({ exec: done('', 137) }, 'all-killed').run);
  const verdict = await adapter.check.run({ root, rules: ['cosmic-ray/mutants-detected'] });
  assert.equal(verdict.verdict === 'refuse' && verdict.why.code, 'cosmic-ray-producer-unsuccessful');
}));

test('a signalled dump refuses', () => withProject(async root => {
  const signalled: CommandExecution = { kind: 'refused', code: 'command-signaled', message: 'killed' };
  const adapter = createCosmicRayAdapter({ rules }, fake({ dump: signalled }).run);
  const verdict = await adapter.check.run({ root, rules: ['cosmic-ray/mutation-score'] });
  assert.equal(verdict.verdict === 'refuse' && verdict.why.code, 'command-signaled');
}));

test('an empty dump (zero mutants) refuses for each rule alone', () => withProject(async root => {
  const a = createCosmicRayAdapter({ rules: { mutantsDetected: true } }, fake({ dump: done('') }).run);
  const b = createCosmicRayAdapter({ rules: { mutationScore: { minimum: 1 } } }, fake({ dump: done('') }).run);
  for (const verdict of [await a.check.run({ root, rules: ['cosmic-ray/mutants-detected'] }), await b.check.run({ root, rules: ['cosmic-ray/mutation-score'] })]) {
    assert.equal(verdict.verdict === 'refuse' && verdict.why.code, 'cosmic-ray-no-mutants');
  }
}));

test('a missing cosmic_ray module is not reported as a failing suite', () => withProject(async root => {
  const missing: CommandExecution = { kind: 'completed', exitCode: 1, stdout: '', stderr: "No module named 'cosmic_ray'" };
  const adapter = createCosmicRayAdapter({ rules }, fake({ baseline: missing }).run);
  const verdict = await adapter.check.run({ root, rules: ['cosmic-ray/mutants-detected'] });
  assert.equal(verdict.verdict === 'refuse' && verdict.why.code, 'cosmic-ray-not-installed');
}));

test('a bad config (exit 78) is named as such, and an unexplained baseline exit is not a failing suite', () => withProject(async root => {
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

test('a module path outside the working directory refuses BEFORE exec runs', () => withProject(async root => {
  const escaping = dumpText('all-killed').replaceAll('"module_path": "mod.py"', '"module_path": "/etc/mod.py"');
  const { calls, run } = fake({ dump: done(escaping) });
  const adapter = createCosmicRayAdapter({ rules }, run);
  const verdict = await adapter.check.run({ root, rules: ['cosmic-ray/mutants-detected'] });
  assert.equal(verdict.verdict === 'refuse' && verdict.why.code, 'cosmic-ray-module-path-escapes');
  assert.ok(!calls.some(call => call.args?.[2] === 'exec'));
}));

test('every step runs in a sandbox copy, never in the project itself', () => withProject(async root => {
  const { calls, run } = fake({});
  const adapter = createCosmicRayAdapter({ rules }, run);
  await adapter.check.run({ root, rules: ['cosmic-ray/mutants-detected'] });
  const real = await realpath(root);
  assert.ok(calls.length > 0 && calls.every(call => call.cwd !== real && !call.cwd.startsWith(`${real}/`)));
}));

test('a project over maxCopyBytes refuses before any step runs', () => withProject(async root => {
  await writeFile(join(root, 'big.txt'), 'x'.repeat(2000));
  const { calls, run } = fake({});
  const adapter = createCosmicRayAdapter({ rules, maxCopyBytes: 1000 }, run);
  const verdict = await adapter.check.run({ root, rules: ['cosmic-ray/mutants-detected'] });
  assert.equal(verdict.verdict === 'refuse' && verdict.why.code, 'cosmic-ray-copy-too-large');
  assert.equal(calls.length, 0);
}));

const failing: RunEffects = { remove: async () => { throw new Error('EBUSY: resource busy'); }, now: () => Date.now() };

test('cleanup policy: a cleanup failure demotes a PASS to a REFUSE that names the leftover', () => withProject(async root => {
  const adapter = createCosmicRayAdapter({ rules: { mutantsDetected: true } }, fake({}, 'all-killed').run, failing);
  const verdict = await adapter.check.run({ root, rules: ['cosmic-ray/mutants-detected'] });
  assert.equal(verdict.verdict === 'refuse' && verdict.why.code, 'cosmic-ray-cleanup-unavailable');
  assert.match(verdict.verdict === 'refuse' ? verdict.why.detail ?? '' : '', /Could not remove .*EBUSY/u);
}));

test('cleanup policy: a REFUSE keeps its own code and gains the leaked path in its detail', () => withProject(async root => {
  const adapter = createCosmicRayAdapter({ rules }, fake({ baseline: done('', 3) }).run, failing);
  const verdict = await adapter.check.run({ root, rules: ['cosmic-ray/mutants-detected'] });
  assert.equal(verdict.verdict === 'refuse' && verdict.why.code, 'cosmic-ray-producer-unsuccessful');
  assert.match(verdict.verdict === 'refuse' ? verdict.why.detail ?? '' : '', /exit code: 3[\s\S]*Could not remove .*EBUSY/u);
}));

test('cleanup policy: a FAIL keeps its breaches (a real failure is never hidden by a cleanup problem)', () => withProject(async root => {
  const adapter = createCosmicRayAdapter({ rules: { mutantsDetected: true } }, fake({}, 'survivors').run, failing);
  const verdict = await adapter.check.run({ root, rules: ['cosmic-ray/mutants-detected'] });
  assert.equal(verdict.verdict, 'fail');
}));

test('the sandbox is removed on pass, refuse and a throwing runner', () => withProject(async root => {
  for (const make of [() => fake({}, 'all-killed'), () => fake({ baseline: done('', 3) }), () => ({ calls: [] as { cwd: string }[], run: async (o: { cwd: string }) => { (this as never); throw new Error(`boom ${o.cwd}`); } })]) {
    const { calls, run } = make() as ReturnType<typeof fake>;
    const adapter = createCosmicRayAdapter({ rules: { mutantsDetected: true } }, run as never);
    const verdict = await adapter.check.run({ root, rules: ['cosmic-ray/mutants-detected'] });
    assert.ok(verdict.verdict === 'pass' || verdict.verdict === 'refuse');
    const cwd = (calls[0]?.cwd) ?? (verdict.verdict === 'refuse' ? /boom (\S+)/u.exec(verdict.why.detail ?? '')?.[1] : undefined);
    assert.ok(cwd && !existsSync(cwd), `sandbox ${cwd} should be gone`);
  }
}));

test('timeoutMs is one deadline for the whole run: later steps get what is left, and an exhausted deadline refuses', () => withProject(async root => {
  let clock = 1000;
  const seen: number[] = [];
  const run = async (options: { timeoutMs?: number }) => { seen.push(options.timeoutMs ?? -1); clock += 40; return done(''); };
  const adapter = createCosmicRayAdapter({ rules, timeoutMs: 100 }, run as never, { remove: async () => undefined, now: () => clock });
  const verdict = await adapter.check.run({ root, rules: ['cosmic-ray/mutants-detected'] });
  assert.deepEqual(seen, [100, 60, 20]);
  assert.equal(verdict.verdict === 'refuse' && verdict.why.code, 'command-timeout');
}));

test('links never lead back to the real tree: absolute and relative links are rebuilt or copied inside the sandbox', () => withProject(async root => withWorkspace(async outside => {
  await mkdir(join(root, 'pkg'));
  await writeFile(join(root, 'pkg', 'real.py'), 'x = 1\n');
  await writeFile(join(outside, 'vendored.py'), 'y = 2\n');
  await symlink(join(root, 'pkg'), join(root, 'abs-into-root'), 'dir');
  await symlink(outside, join(root, 'vendor'), 'dir');
  await mkdir(join(root, 'env'));
  await writeFile(join(root, 'env', 'src.py'), 'z = 3\n');
  const seen: string[] = [];
  const run = async (options: { cwd: string; args?: readonly string[] }) => {
    if (options.args?.[2] === 'dump') {
      for (const rel of ['abs-into-root/real.py', 'vendor/vendored.py', 'env/src.py']) {
        await writeFile(join(options.cwd, rel), 'MUTATED\n');
        seen.push(rel);
      }
    }
    return done(options.args?.[2] === 'dump' ? dumpText('all-killed') : '');
  };
  const adapter = createCosmicRayAdapter({ rules }, run as never);
  await adapter.check.run({ root, rules: ['cosmic-ray/mutants-detected'] });
  assert.equal(new Set(seen).size, 3);
  assert.equal(await readFile(join(root, 'pkg', 'real.py'), 'utf8'), 'x = 1\n');
  assert.equal(await readFile(join(outside, 'vendored.py'), 'utf8'), 'y = 2\n');
  assert.equal(await readFile(join(root, 'env', 'src.py'), 'utf8'), 'z = 3\n');
})));

test('a final dump whose jobs differ from the planned jobs refuses (a partial-but-valid dump cannot pass)', () => withProject(async root => {
  const calls: string[] = [];
  const full = dumpText('all-killed');
  const fewer = full.split('\n').filter(Boolean).slice(0, 5).join('\n');
  const run = async (options: { args?: readonly string[] }) => {
    const step = options.args?.[2] ?? '';
    calls.push(step);
    const dumps = calls.filter(call => call === 'dump').length;
    return done(step === 'dump' ? (dumps === 1 ? full : fewer) : '');
  };
  const adapter = createCosmicRayAdapter({ rules: { mutationScore: { minimum: 1 } } }, run as never);
  const verdict = await adapter.check.run({ root, rules: ['cosmic-ray/mutation-score'] });
  assert.equal(verdict.verdict === 'refuse' && verdict.why.code, 'cosmic-ray-report-invalid');
}));

test('a project with more entries than maxCopyEntries refuses before any step runs', () => withProject(async root => {
  for (const name of ['a', 'b', 'c', 'd']) await writeFile(join(root, `${name}.txt`), '');
  const { calls, run } = fake({});
  const adapter = createCosmicRayAdapter({ rules, maxCopyEntries: 3 }, run);
  const verdict = await adapter.check.run({ root, rules: ['cosmic-ray/mutants-detected'] });
  assert.equal(verdict.verdict === 'refuse' && verdict.why.code, 'cosmic-ray-copy-too-large');
  assert.equal(calls.length, 0);
}));

test('a module path that climbs out of a sub-directory but stays inside the project is accepted', () => withProject(async root => {
  await mkdir(join(root, 'svc'));
  const climbing = dumpText('all-killed').replaceAll('"module_path": "mod.py"', '"module_path": "../mod.py"');
  const adapter = createCosmicRayAdapter({ rules, cwd: 'svc' }, fake({ dump: done(climbing) }).run);
  const verdict = await adapter.check.run({ root, rules: ['cosmic-ray/mutants-detected'] });
  assert.equal(verdict.verdict, 'pass');
}));

test('a FAIL with a cleanup leak keeps its breaches and names the leftover in the first breach', () => withProject(async root => {
  const adapter = createCosmicRayAdapter({ rules: { mutantsDetected: true } }, fake({}, 'survivors').run, failing);
  const verdict = await adapter.check.run({ root, rules: ['cosmic-ray/mutants-detected'] });
  assert.equal(verdict.verdict, 'fail');
  if (verdict.verdict === 'fail') {
    assert.equal(verdict.breaches.length, 7);
    assert.match(verdict.breaches[0].detail ?? '', /Could not remove .*EBUSY/u);
  }
}));

test('documented boundary: a test may write into a linked environment directory, but never into source files', () => withProject(async root => {
  await mkdir(join(root, '.venv'));
  await writeFile(join(root, '.venv', 'pyvenv.cfg'), 'home = /x\n');
  const run = async (options: { cwd: string; args?: readonly string[] }) => {
    if (options.args?.[2] === 'exec') {
      await writeFile(join(options.cwd, '.venv', 'cache.bin'), 'written by a test');
      await writeFile(join(options.cwd, 'mod.py'), 'MUTATED');
    }
    return done(options.args?.[2] === 'dump' ? dumpText('all-killed') : '');
  };
  await createCosmicRayAdapter({ rules }, run as never).check.run({ root, rules: ['cosmic-ray/mutants-detected'] });
  assert.equal(existsSync(join(root, '.venv', 'cache.bin')), true, 'linked environments are shared, as the README says');
  assert.equal(await readFile(join(root, 'mod.py'), 'utf8'), 'def add(a, b):\n    return a + b\n');
}));

test('a link to the project root or one of its ancestors is not followed (it would pull the rest of the disk into the copy)', () => withProject(async root => withWorkspace(async parent => {
  const project = join(parent, 'project');
  await mkdir(project);
  await writeFile(join(project, 'mod.py'), 'def add(a, b):\n    return a + b\n');
  await writeFile(join(parent, 'unrelated-secret.txt'), 'not part of the project');
  await symlink('..', join(project, 'up'), 'dir');
  await symlink('.', join(project, 'self'), 'dir');
  const seen: string[] = [];
  const run = async (options: { cwd: string; args?: readonly string[] }) => {
    if (options.args?.[2] === 'baseline') seen.push(existsSync(join(options.cwd, 'up')) ? 'up copied' : 'up skipped', existsSync(join(options.cwd, 'self')) ? 'self copied' : 'self skipped');
    return done(options.args?.[2] === 'dump' ? dumpText('all-killed') : '');
  };
  await createCosmicRayAdapter({ rules }, run as never).check.run({ root: project, rules: ['cosmic-ray/mutants-detected'] });
  assert.deepEqual(seen, ['up skipped', 'self skipped']);
  assert.ok(root.length > 0);
})));

test('a kill without the Redproof marker (a distributor that does not run through the driver) refuses', () => withProject(async root => {
  const unmarked = dumpText('all-killed').replaceAll('REDPROOF-EXIT 1\\n', '');
  const adapter = createCosmicRayAdapter({ rules: { mutationScore: { minimum: 1 } } }, fake({ dump: done(unmarked) }).run);
  const verdict = await adapter.check.run({ root, rules: ['cosmic-ray/mutation-score'] });
  assert.equal(verdict.verdict === 'refuse' && verdict.why.code, 'cosmic-ray-incomplete');
  assert.match(verdict.verdict === 'refuse' ? verdict.why.detail ?? '' : '', /not made through the Redproof driver/u);
}));
