import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineGate, runGate } from 'redproof';
import { cosmicRay } from '../src/index.ts';
import { withWorkspace } from './support/workspace.ts';

// Real cosmic-ray from the battle-test venv (25-cosmic-ray/.venv), which also has pytest.
const python = process.env.REDPROOF_COSMIC_RAY_PYTHON
  ?? fileURLToPath(new URL('../../../../25-cosmic-ray/.venv/bin/python', import.meta.url));
// The repo gate bans skipped tests, so without cosmic-ray and pytest these are not registered at all. Run them with
// REDPROOF_COSMIC_RAY_PYTHON pointing at a python that has both installed. CI sets REDPROOF_COSMIC_RAY_REQUIRED=1,
// so there a missing tool FAILS instead of silently dropping the real-tool proofs.
const available = existsSync(python) && spawnSync(python, ['-c', 'import cosmic_ray, pytest'], { stdio: 'ignore' }).status === 0;
if (!available && process.env.REDPROOF_COSMIC_RAY_REQUIRED === '1') {
  test('real cosmic-ray is installed where it is required', () => {
    assert.fail(`REDPROOF_COSMIC_RAY_REQUIRED=1 but ${python} cannot import cosmic_ray and pytest.`);
  });
}
const nativeTest: typeof test = available ? test : (Object.assign(() => undefined, test) as never);

const MODULE = 'def add(a, b):\n    return a + b\n';
const STRONG = 'from mod import add\n\ndef test_add():\n    assert add(2, 3) == 5\n';
const WEAK = 'from mod import add\n\ndef test_add():\n    assert add(0, 0) == 0\n';
const BROKEN = 'from mod import add\n\ndef test_add():\n    assert add(2, 3) == 99\n';
const SLOW = 'import time\nfrom mod import add\n\ndef test_add():\n    time.sleep(0.2 if add(1, 1) == 2 else 20)\n    assert add(2, 3) == 5\n';
const LOOP = 'def count(n):\n    i = 0\n    while i < n:\n        i += 1\n    return i\n';
const LOOP_TEST = 'from mod import count\n\ndef test_count():\n    assert count(3) == 3\n    assert count(0) == 0\n    assert count(-5) == 0\n';

async function project(root: string, tests: string, timeout = 10, source = MODULE) {
  await writeFile(join(root, 'mod.py'), source);
  await writeFile(join(root, 'test_mod.py'), tests);
  await writeFile(join(root, 'cosmic-ray.toml'), `[cosmic-ray]\nmodule-path = "mod.py"\ntimeout = ${timeout}.0\nexcluded-modules = []\n`
    + `test-command = "${python} -m pytest -x -q test_mod.py"\n\n[cosmic-ray.distributor]\nname = "local"\n`);
}

/** One rule at a time, through the real Gate, so each rule must catch the problem by itself. */
async function outcome(root: string, rules: object, extra: object = {}): Promise<string[]> {
  const adapter = cosmicRay({ python, rules, ...extra } as never) as never;
  const verdict = await runGate(defineGate({ id: 'mutation', adapter }), root);
  if (verdict.verdict === 'fail') return ['fail', ...verdict.breaches.map(item => `${item.rule}:${item.code}@${item.location?.file}:${item.location?.line}`)];
  if (verdict.verdict === 'refuse') return ['refuse', verdict.why.code];
  return [verdict.verdict];
}

const SCORE = { mutationScore: { minimum: 50 } } as const;
const DETECTED = { mutantsDetected: true } as const;

nativeTest('real cosmic-ray: mutants-detected GREEN -> RED -> GREEN', () => withWorkspace(async root => {
  await project(root, STRONG);
  assert.deepEqual(await outcome(root, DETECTED), ['pass']);
  await project(root, WEAK);
  const red = await outcome(root, DETECTED);
  assert.equal(red[0], 'fail');
  assert.equal(red.length, 8, 'seven survivors, one breach each');
  assert.ok(red.slice(1).every(item => item === 'cosmic-ray/mutants-detected:mutant-survived@mod.py:2'));
  await project(root, STRONG);
  assert.deepEqual(await outcome(root, DETECTED), ['pass']);
}));

nativeTest('real cosmic-ray: mutation-score GREEN -> RED -> GREEN', () => withWorkspace(async root => {
  await project(root, STRONG);
  assert.deepEqual(await outcome(root, SCORE), ['pass']);
  await project(root, WEAK);
  assert.deepEqual(await outcome(root, SCORE), ['fail', 'cosmic-ray/mutation-score:mutation-score-below-minimum@undefined:undefined']);
  await project(root, STRONG);
  assert.deepEqual(await outcome(root, SCORE), ['pass']);
}));

nativeTest('real cosmic-ray: a suite failing on unmutated code REFUSES for each rule alone', () => withWorkspace(async root => {
  await project(root, BROKEN);
  assert.deepEqual(await outcome(root, DETECTED), ['refuse', 'cosmic-ray-baseline-failed']);
  assert.deepEqual(await outcome(root, SCORE), ['refuse', 'cosmic-ray-baseline-failed']);
}));

nativeTest('real cosmic-ray: every mutant timing out REFUSES (the timeout is too short), whatever the timeouts option says', () => withWorkspace(async root => {
  await project(root, SLOW, 1);
  assert.deepEqual(await outcome(root, DETECTED), ['refuse', 'cosmic-ray-timeouts-excessive']);
  assert.deepEqual(await outcome(root, SCORE), ['refuse', 'cosmic-ray-timeouts-excessive']);
  assert.deepEqual(await outcome(root, SCORE, { timeouts: 'refuse' }), ['refuse', 'cosmic-ray-incomplete']);
}));

nativeTest('real cosmic-ray: one infinite-loop mutant is detected by default and refuses with timeouts: refuse', () => withWorkspace(async root => {
  await project(root, LOOP_TEST, 2, LOOP);
  assert.deepEqual(await outcome(root, DETECTED), ['pass']);
  assert.deepEqual(await outcome(root, { mutationScore: { minimum: 100 } }), ['pass']);
  assert.deepEqual(await outcome(root, DETECTED, { timeouts: 'refuse' }), ['refuse', 'cosmic-ray-incomplete']);
  assert.deepEqual(await outcome(root, { mutationScore: { minimum: 100 } }, { timeouts: 'refuse' }), ['refuse', 'cosmic-ray-incomplete']);
}));

nativeTest('real cosmic-ray: a killed run leaves the project byte-identical and the next run starts from the original code', () => withWorkspace(async root => {
  await project(root, 'import time\nfrom mod import add\n\ndef test_add():\n    time.sleep(1.5)\n    assert add(2, 3) == 5\n', 20);
  const files = ['mod.py', 'test_mod.py', 'cosmic-ray.toml'];
  const before = await Promise.all(files.map(file => readFile(join(root, file), 'utf8')));
  // The adapter SIGKILLs cosmic-ray on its own timeout while a mutant is written into the source it is running on.
  assert.deepEqual(await outcome(root, DETECTED, { timeoutMs: 7000 }), ['refuse', 'command-timeout']);
  assert.deepEqual(await Promise.all(files.map(file => readFile(join(root, file), 'utf8'))), before);
  // Had the source stayed mutated, this strong suite would already fail its baseline.
  await project(root, STRONG);
  assert.deepEqual(await outcome(root, DETECTED), ['pass']);
}));

nativeTest('real cosmic-ray: a test executable that does not exist REFUSES (baseline alone would pass)', () => withWorkspace(async root => {
  await project(root, STRONG);
  const toml = join(root, 'cosmic-ray.toml');
  await writeFile(toml, (await readFile(toml, 'utf8')).replace(/test-command = ".*"/u, 'test-command = "/nonexistent/pytest"'));
  assert.deepEqual(await outcome(root, DETECTED), ['refuse', 'cosmic-ray-incomplete']);
  assert.deepEqual(await outcome(root, SCORE), ['refuse', 'cosmic-ray-incomplete']);
}));

nativeTest('real cosmic-ray: excluding the only module (zero mutants) REFUSES for each rule alone', () => withWorkspace(async root => {
  await project(root, STRONG);
  const toml = join(root, 'cosmic-ray.toml');
  await writeFile(toml, (await readFile(toml, 'utf8')).replace('excluded-modules = []', 'excluded-modules = ["mod.py"]'));
  assert.deepEqual(await outcome(root, DETECTED), ['refuse', 'cosmic-ray-no-mutants']);
  assert.deepEqual(await outcome(root, SCORE), ['refuse', 'cosmic-ray-no-mutants']);
}));

nativeTest('real cosmic-ray: a module path that matches nothing REFUSES for each rule alone', () => withWorkspace(async root => {
  await project(root, STRONG);
  const toml = join(root, 'cosmic-ray.toml');
  await writeFile(toml, (await readFile(toml, 'utf8')).replace('module-path = "mod.py"', 'module-path = "nothere.py"'));
  assert.deepEqual(await outcome(root, DETECTED), ['refuse', 'cosmic-ray-producer-unsuccessful']);
  assert.deepEqual(await outcome(root, SCORE), ['refuse', 'cosmic-ray-producer-unsuccessful']);
}));

nativeTest('real cosmic-ray: an absolute module path is refused before any mutation, and the real file stays untouched', () => withWorkspace(async root => {
  await project(root, STRONG);
  const toml = join(root, 'cosmic-ray.toml');
  await writeFile(toml, (await readFile(toml, 'utf8')).replace('module-path = "mod.py"', `module-path = "${join(root, 'mod.py')}"`));
  assert.deepEqual(await outcome(root, DETECTED), ['refuse', 'cosmic-ray-module-path-escapes']);
  assert.equal(await readFile(join(root, 'mod.py'), 'utf8'), MODULE);
}));

nativeTest('real cosmic-ray: a missing config file is named, not blamed on the tests', () => withWorkspace(async root => {
  await project(root, STRONG);
  assert.deepEqual(await outcome(root, DETECTED, { config: 'missing.toml' }), ['refuse', 'cosmic-ray-config-invalid']);
}));

nativeTest('real cosmic-ray: a python without cosmic-ray is named, not blamed on the tests', () => withWorkspace(async root => {
  await project(root, STRONG);
  const bare = spawnSync('python3', ['-c', 'import cosmic_ray'], { stdio: 'ignore' }).status !== 0 ? 'python3' : undefined;
  if (bare === undefined) return;
  const verdict = await runGate(defineGate({ id: 'mutation', adapter: cosmicRay({ python: bare, rules: DETECTED }) as never }), root);
  assert.equal(verdict.verdict === 'refuse' && verdict.why.code, 'cosmic-ray-not-installed');
}));

/** Every file below `dir` (not following links) as path -> bytes, so two snapshots can be compared byte for byte. */
async function snapshot(dir: string, base = dir): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(files, await snapshot(path, base));
    else if (entry.isFile()) files[path.slice(base.length)] = await readFile(path, 'utf8');
  }
  return files;
}

const SLEEPY = (importLine: string) => `import time\n${importLine}\n\ndef test_add():\n    time.sleep(1.5)\n    assert add(2, 3) == 5\n`;

async function withOutside<T>(fn: (root: string, outside: string) => Promise<T>): Promise<T> {
  return withWorkspace(root => withWorkspace(outside => fn(root, outside)));
}

nativeTest('real cosmic-ray: the real tree is byte-identical after PASS, FAIL, REFUSE and a killed run', () => withWorkspace(async root => {
  await project(root, STRONG);
  let before = await snapshot(root);
  assert.deepEqual(await outcome(root, DETECTED), ['pass']);
  assert.deepEqual(await snapshot(root), before);
  await project(root, WEAK);
  before = await snapshot(root);
  assert.equal((await outcome(root, DETECTED))[0], 'fail');
  assert.deepEqual(await snapshot(root), before);
  await project(root, BROKEN);
  before = await snapshot(root);
  assert.equal((await outcome(root, DETECTED))[0], 'refuse');
  assert.deepEqual(await snapshot(root), before);
  await project(root, SLEEPY('from mod import add'), 20);
  before = await snapshot(root);
  assert.deepEqual(await outcome(root, DETECTED, { timeoutMs: 7000 }), ['refuse', 'command-timeout']);
  assert.deepEqual(await snapshot(root), before);
}));

nativeTest('real cosmic-ray: an absolute symlink to a source directory cannot be mutated through the sandbox', () => withOutside(async (root, outside) => {
  await writeFile(join(outside, 'mod.py'), MODULE);
  await symlink(outside, join(root, 'vendor'), 'dir');
  await project(root, SLEEPY('from vendor.mod import add'), 20);
  await writeFile(join(root, 'cosmic-ray.toml'), (await readFile(join(root, 'cosmic-ray.toml'), 'utf8')).replace('module-path = "mod.py"', 'module-path = "vendor/mod.py"'));
  const before = { root: await snapshot(root), outside: await snapshot(outside) };
  // killed while a mutant is written into the source it runs on
  await outcome(root, DETECTED, { timeoutMs: 7000 });
  assert.deepEqual(await snapshot(outside), before.outside);
  assert.deepEqual(await snapshot(root), before.root);
}));

nativeTest('real cosmic-ray: a source package that happens to be called env cannot be mutated through the sandbox', () => withWorkspace(async root => {
  await mkdir(join(root, 'env'));
  await writeFile(join(root, 'env', 'mod.py'), MODULE);
  await project(root, SLEEPY('from env.mod import add'), 20);
  await writeFile(join(root, 'cosmic-ray.toml'), (await readFile(join(root, 'cosmic-ray.toml'), 'utf8')).replace('module-path = "mod.py"', 'module-path = "env/mod.py"'));
  const before = await snapshot(root);
  await outcome(root, DETECTED, { timeoutMs: 7000 });
  assert.deepEqual(await snapshot(root), before);
}));

nativeTest('real cosmic-ray: a module path that goes through a linked environment REFUSES before exec and the target stays untouched', () => withOutside(async (root, outside) => {
  await writeFile(join(outside, 'mod.py'), MODULE);
  await symlink(outside, join(root, '.venv'), 'dir');
  await project(root, STRONG);
  await writeFile(join(root, 'cosmic-ray.toml'), (await readFile(join(root, 'cosmic-ray.toml'), 'utf8')).replace('module-path = "mod.py"', 'module-path = ".venv/mod.py"'));
  const before = await snapshot(outside);
  assert.deepEqual(await outcome(root, DETECTED), ['refuse', 'cosmic-ray-module-path-escapes']);
  assert.deepEqual(await snapshot(outside), before);
}));
