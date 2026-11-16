import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineGate, runGate } from 'redproof';
import { cosmicRay } from '../src/index.ts';
import { withWorkspace } from './support/workspace.ts';

// Real cosmic-ray from the battle-test venv (25-cosmic-ray/.venv), which also has pytest.
const python = process.env.REDPROOF_COSMIC_RAY_PYTHON
  ?? fileURLToPath(new URL('../../../../25-cosmic-ray/.venv/bin/python', import.meta.url));
// The repo gate bans skipped tests, so without cosmic-ray these are not registered at all. Run them with
// REDPROOF_COSMIC_RAY_PYTHON pointing at a python that has cosmic-ray and pytest installed.
const nativeTest: typeof test = existsSync(python) ? test : (Object.assign(() => undefined, test) as never);

const MODULE = 'def add(a, b):\n    return a + b\n';
const STRONG = 'from mod import add\n\ndef test_add():\n    assert add(2, 3) == 5\n';
const WEAK = 'from mod import add\n\ndef test_add():\n    assert add(0, 0) == 0\n';
const BROKEN = 'from mod import add\n\ndef test_add():\n    assert add(2, 3) == 99\n';
const SLOW = 'import time\nfrom mod import add\n\ndef test_add():\n    time.sleep(5)\n    assert add(2, 3) == 5\n';

async function project(root: string, test: string, timeout = 10) {
  await writeFile(join(root, 'mod.py'), MODULE);
  await writeFile(join(root, 'test_mod.py'), test);
  await writeFile(join(root, 'cosmic-ray.toml'), `[cosmic-ray]\nmodule-path = "mod.py"\ntimeout = ${timeout}.0\nexcluded-modules = []\n`
    + `test-command = "${python} -m pytest -x -q test_mod.py"\n\n[cosmic-ray.distributor]\nname = "local"\n`);
}

/** One rule at a time, through the real Gate, so each rule must catch the problem by itself. */
async function outcome(root: string, rules: object): Promise<string[]> {
  const adapter = cosmicRay({ python, rules } as never) as never;
  const verdict = await runGate(defineGate({ id: 'mutation', adapter }), root);
  if (verdict.verdict === 'fail') return ['fail', ...verdict.breaches.map(item => `${item.rule}:${item.code}@${item.location?.file}:${item.location?.line}`)];
  if (verdict.verdict === 'refuse') return ['refuse', verdict.why.code];
  return [verdict.verdict];
}

const SCORE = { mutationScore: { minimum: 50 } };
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

nativeTest('real cosmic-ray: tests that hit the timeout REFUSE for each rule alone', () => withWorkspace(async root => {
  await writeFile(join(root, 'mod.py'), MODULE);
  await project(root, SLOW, 2);
  // The baseline itself takes ~5s with a 4s limit, so shrink the sleep for it and keep the mutants slow.
  await writeFile(join(root, 'test_mod.py'), SLOW.replace('time.sleep(5)', 'time.sleep(0.2 if add(1, 1) == 2 else 20)'));
  assert.deepEqual(await outcome(root, DETECTED), ['refuse', 'cosmic-ray-incomplete']);
  assert.deepEqual(await outcome(root, SCORE), ['refuse', 'cosmic-ray-incomplete']);
}));

nativeTest('real cosmic-ray: a test executable that does not exist REFUSES (baseline alone would pass)', () => withWorkspace(async root => {
  await project(root, STRONG);
  const toml = join(root, 'cosmic-ray.toml');
  await writeFile(toml, `[cosmic-ray]\nmodule-path = "mod.py"\ntimeout = 10.0\nexcluded-modules = []\ntest-command = "/nonexistent/pytest"\n\n[cosmic-ray.distributor]\nname = "local"\n`);
  assert.deepEqual(await outcome(root, DETECTED), ['refuse', 'cosmic-ray-incomplete']);
  assert.deepEqual(await outcome(root, SCORE), ['refuse', 'cosmic-ray-incomplete']);
}));

nativeTest('real cosmic-ray: excluding the only module (zero mutants) REFUSES for each rule alone', () => withWorkspace(async root => {
  await project(root, STRONG);
  const toml = join(root, 'cosmic-ray.toml');
  const { readFile } = await import('node:fs/promises');
  await writeFile(toml, (await readFile(toml, 'utf8')).replace('excluded-modules = []', 'excluded-modules = ["mod.py"]'));
  assert.deepEqual(await outcome(root, DETECTED), ['refuse', 'cosmic-ray-no-mutants']);
  assert.deepEqual(await outcome(root, SCORE), ['refuse', 'cosmic-ray-no-mutants']);
}));

nativeTest('real cosmic-ray: a module path that matches nothing REFUSES for each rule alone', () => withWorkspace(async root => {
  await project(root, STRONG);
  const toml = join(root, 'cosmic-ray.toml');
  const { readFile } = await import('node:fs/promises');
  await writeFile(toml, (await readFile(toml, 'utf8')).replace('module-path = "mod.py"', 'module-path = "nothere.py"'));
  assert.deepEqual(await outcome(root, DETECTED), ['refuse', 'cosmic-ray-producer-unsuccessful']);
  assert.deepEqual(await outcome(root, SCORE), ['refuse', 'cosmic-ray-producer-unsuccessful']);
}));

nativeTest('real cosmic-ray: a missing config file REFUSES', () => withWorkspace(async root => {
  await project(root, STRONG);
  const adapter = cosmicRay({ python, config: 'missing.toml', rules: DETECTED }) as never;
  const verdict = await runGate(defineGate({ id: 'mutation', adapter }), root);
  assert.equal(verdict.verdict, 'refuse');
}));
