import assert from 'node:assert/strict';
import test from 'node:test';
import { breach, counting, defineRule, type Breach, type CheckResult, type Scan } from 'redproof';
import { scanning } from '../../gates/support/scanning.ts';

const ruleA = defineRule({ id: 'probe/a', description: 'Rule A.' });
const ruleB = defineRule({ id: 'probe/b', description: 'Rule B.' });

const delegateScan: Scan = { source: 'delegate', startedAt: '', finishedAt: '', inspected: 1 };

const breachA = breach(ruleA, { code: 'x', message: 'x', location: null });
const breachB = breach(ruleB, { code: 'y', message: 'y', location: null });

type Probe = 'probe/a' | 'probe/b';

function probe(spec: {
  gather?: (root: string) => Promise<number>;
  inspected?: (value: number) => number;
  breaches?: (value: number) => readonly Breach<Probe>[];
  delegate?: (root: string) => Promise<CheckResult<Probe>>;
}) {
  return scanning<Probe, number>({
    description: 'probe the workspace',
    source: 'probe scan',
    gather: spec.gather ?? (async () => 0),
    inspected: spec.inspected ?? (value => value),
    breaches: spec.breaches ?? (() => []),
    ...(spec.delegate ? { delegate: spec.delegate } : {}),
    whenUnavailable: { code: 'probe-unavailable', message: 'Probe inputs could not be read.' },
  });
}

const run = (check: ReturnType<typeof probe>, root = '.') => check.run({ root, rules: [ruleA.id, ruleB.id] });

test('a scanning Check states its description and that it can count breaches', () => {
  const check = probe({});

  assert.equal(check.description, 'probe the workspace');
  assert.deepEqual(check.counting, counting.supported);
});

test('scanning gathers from the Gate root and reports PASS with the inspected count and a closed window', async () => {
  const roots: string[] = [];
  const before = new Date().toISOString();
  const result = await run(probe({ gather: async root => { roots.push(root); return 7; } }), '/tmp/probe-root');
  const after = new Date().toISOString();

  assert.deepEqual(roots, ['/tmp/probe-root'], 'the Check reads the root it was given');
  assert.equal(result.verdict, 'pass');
  assert.equal(result.scan.source, 'probe scan');
  assert.equal(result.scan.inspected, 7);
  assert.ok(result.scan.startedAt >= before, 'the window cannot start before the run did');
  assert.ok(result.scan.startedAt <= result.scan.finishedAt);
  assert.ok(result.scan.finishedAt <= after, 'the window cannot end after the run did');
});

test('scanning reports FAIL with one breach per finding, and still counts what it inspected', async () => {
  const result = await run(probe({ gather: async () => 3, breaches: () => [breachA, breachB] }));

  assert.equal(result.verdict, 'fail');
  assert.equal(result.scan.inspected, 3);
  if (result.verdict !== 'fail') throw new Error('expected fail');
  assert.deepEqual(result.breaches.map(item => item.rule), ['probe/a', 'probe/b']);
});

test('scanning REFUSES when the inputs cannot be read, and never reports PASS', async () => {
  const result = await run(probe({ gather: async () => { throw new Error('disk on fire'); } }));

  assert.equal(result.verdict, 'refuse');
  if (result.verdict !== 'refuse') throw new Error('expected refuse');
  assert.equal(result.why.code, 'probe-unavailable');
  assert.equal(result.why.message, 'Probe inputs could not be read.');
  assert.equal(result.why.detail, 'disk on fire');
  assert.equal(result.why.location, null);
  assert.equal(result.scan.inspected, null, 'a Check that could not read its inputs inspected nothing it can count');
  assert.equal(result.scan.source, 'probe scan');
});

test('a refusal reports a non-Error failure as text', async () => {
  const result = await run(probe({ gather: async () => { throw 'plain string'; } }));

  assert.equal(result.verdict, 'refuse');
  if (result.verdict !== 'refuse') throw new Error('expected refuse');
  assert.equal(result.why.detail, 'plain string');
});

test('a delegate FAIL is carried, and its breaches come before the Check findings', async () => {
  const delegated: CheckResult<Probe> = { verdict: 'fail', scan: delegateScan, breaches: [breachB] };
  const result = await run(probe({ delegate: async () => delegated, gather: async () => 1, breaches: () => [breachA] }));

  assert.equal(result.verdict, 'fail');
  if (result.verdict !== 'fail') throw new Error('expected fail');
  assert.deepEqual(result.breaches.map(item => item.rule), ['probe/b', 'probe/a']);
  assert.equal(result.scan.source, 'probe scan', 'the report describes the Check scan, not the delegate scan');
  assert.equal(result.scan.inspected, 1);
});

test('a delegate FAIL alone makes the Check FAIL even when the Check finds nothing', async () => {
  const delegated: CheckResult<Probe> = { verdict: 'fail', scan: delegateScan, breaches: [breachB] };
  const result = await run(probe({ delegate: async () => delegated, gather: async () => 5 }));

  assert.equal(result.verdict, 'fail');
  if (result.verdict !== 'fail') throw new Error('expected fail');
  assert.deepEqual(result.breaches.map(item => item.rule), ['probe/b']);
});

test('a delegate REFUSE wins, and the Check never gathers its own inputs', async () => {
  let gathered = false;
  const result = await run(probe({
    delegate: async () => ({
      verdict: 'refuse',
      scan: delegateScan,
      why: { code: 'delegate-unavailable', message: 'delegate could not run', location: null },
    }),
    gather: async () => { gathered = true; return 1; },
    breaches: () => [breachA],
  }));

  assert.equal(result.verdict, 'refuse');
  if (result.verdict !== 'refuse') throw new Error('expected refuse');
  assert.equal(result.why.code, 'delegate-unavailable');
  assert.deepEqual(result.scan, delegateScan, 'the refusal is reported as the delegate reported it');
  assert.equal(gathered, false, 'a refused delegate must stop the Check');
});

test('a delegate PASS adds no breaches of its own', async () => {
  const result = await run(probe({ delegate: async () => ({ verdict: 'pass', scan: delegateScan }), gather: async () => 2 }));

  assert.equal(result.verdict, 'pass');
  assert.equal(result.scan.inspected, 2);
});

test('a delegate failure is not disguised as a refusal about the Check inputs', async () => {
  const check = probe({ delegate: async () => { throw new Error('delegate exploded'); } });

  await assert.rejects(run(check), /delegate exploded/);
});
