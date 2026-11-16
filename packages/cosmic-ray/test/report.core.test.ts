import assert from 'node:assert/strict';
import test from 'node:test';
import { jobsDiffer, moduleFileInsideRoot, parseCosmicRayDump } from '../src/core/report.ts';
import { dumpText, mutants } from './support/fixtures.ts';

const count = (name: Parameters<typeof mutants>[0], status: string) =>
  mutants(name).filter(mutant => mutant.status === status).length;

test('a real all-killed dump parses to 11 killed mutants with positions', () => {
  assert.equal(mutants('all-killed').length, 11);
  assert.equal(count('all-killed', 'killed'), 11);
  assert.deepEqual(
    [mutants('all-killed')[0]?.modulePath, mutants('all-killed')[0]?.line, mutants('all-killed')[0]?.column],
    ['mod.py', 2, 13],
  );
});

test('a real weak-test dump has the survivors cosmic-ray reported (killed 4, survived 7)', () => {
  assert.equal(count('survivors', 'killed'), 4);
  assert.equal(count('survivors', 'survived'), 7);
});

test('a job without a result is pending', () => {
  assert.equal(count('pending', 'pending'), 11);
});

test('a test run past the timeout is told apart from a kill by its output', () => {
  assert.equal(count('timeout', 'timeout'), 11);
  assert.equal(count('timeout', 'killed'), 0);
});

test('a worker exception is invalid, not killed', () => {
  assert.equal(count('worker-exception', 'invalid'), 11);
  assert.match(mutants('worker-exception')[0]?.reason ?? '', /worker outcome exception/u);
  assert.equal(count('no-test', 'invalid'), 11);
});

test('malformed dumps are errors, never an empty success', () => {
  for (const text of ['not json', '{"a":1}', '[1,2]', '[{"job_id":"x","mutations":[]},null]']) {
    assert.ok(parseCosmicRayDump(text) instanceof Error, text);
  }
  assert.deepEqual(parseCosmicRayDump(''), []);
  assert.ok(dumpText('all-killed').length > 0);
});

test('module paths are confined below the root', () => {
  assert.equal(moduleFileInsideRoot('/r', '/r/svc', 'pkg/m.py'), 'svc/pkg/m.py');
  assert.equal(moduleFileInsideRoot('/r', '/r/svc', '../../x.py'), null);
  assert.equal(moduleFileInsideRoot('/r', '/r', '/etc/x.py'), null);
});

test('cosmic-ray 8.3.15 output (oldest verified) parses; the flat 8.1.0 shape is an error', () => {
  assert.equal(parseCosmicRayDump(dumpText('oldest-supported-8.3.15')) instanceof Error, false);
  assert.ok(parseCosmicRayDump(dumpText('old-format-8.1.0')) instanceof Error);
});

test('a kill with no output is not evidence of detection (a SIGKILLed test process looks like this)', () => {
  const killed = (output: string) => parseCosmicRayDump(JSON.stringify([
    { job_id: 'j', mutations: [{ module_path: 'm.py', operator_name: 'o', occurrence: 0, start_pos: [1, 0], end_pos: [1, 1], operator_args: {} }] },
    { worker_outcome: 'normal', output, test_outcome: 'killed', diff: '' },
  ]));
  assert.equal((killed('') as readonly { status: string }[])[0]?.status, 'invalid');
  assert.equal((killed('  \n') as readonly { status: string }[])[0]?.status, 'invalid');
  assert.equal((killed('F\nFAILED test_x') as readonly { status: string }[])[0]?.status, 'killed');
  assert.equal((killed('timeout') as readonly { status: string }[])[0]?.status, 'timeout');
});

test('final jobs must be exactly the planned jobs', () => {
  const a = mutants('all-killed');
  assert.equal(jobsDiffer(a, a), false);
  assert.equal(jobsDiffer(a, a.slice(1)), true);
  assert.equal(jobsDiffer(a, [...a.slice(1), { ...a[0]!, id: 'someone-else' }]), true);
});
