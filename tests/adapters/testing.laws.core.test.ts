import assert from 'node:assert/strict';
import test from 'node:test';
import { defineRule } from 'redproof';
import { decideCheck } from '../../packages/testing/src/core/check.ts';
import { testCounts, type TestRunnerCompleted, type TestStatus } from '../../packages/testing/src/core/model.ts';
import { parsePytestJunitXml, pytestJunitXml } from '../../packages/testing/src/core/reports/junit-xml.ts';

// Laws for the pure core, checked exhaustively over a small domain (no randomness, no mocks).

type Entry = { readonly key: 'a' | 'b'; readonly status: 'passed' | 'failed' | 'skipped' | 'xfail' };
const STATUSES = ['passed', 'failed', 'skipped', 'xfail'] as const;
const RANK: Readonly<Record<TestStatus, number>> = { failed: 5, xfail: 4, todo: 3, skipped: 2, passed: 1 };

function xmlOf(entries: readonly Entry[]): string {
  const body = entries.map(({ key, status }) => {
    const inner = status === 'failed' ? '<failure message="f"/>'
      : status === 'skipped' ? '<skipped type="pytest.skip" message="s"/>'
      : status === 'xfail' ? '<skipped type="pytest.xfail" message="x"/>' : '';
    return `<testcase classname="t" name="${key}">${inner}</testcase>`;
  }).join('');
  return `<testsuites><testsuite name="s">${body}</testsuite></testsuites>`;
}

/** Every sequence of 1..3 entries over two test names and four statuses (4*... = 2*4 choices per slot). */
function* sequences(): Generator<readonly Entry[]> {
  const slot: Entry[] = (['a', 'b'] as const).flatMap(key => STATUSES.map(status => ({ key, status })));
  for (const x of slot) yield [x];
  for (const x of slot) for (const y of slot) yield [x, y];
  for (const x of slot) for (const y of slot) for (const z of slot) yield [x, y, z];
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [items.slice()];
  return items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map(rest => [item, ...rest]));
}

const shown = (test: { status: TestStatus; alsoStatuses?: readonly TestStatus[] }) =>
  [...new Set([test.status, ...(test.alsoStatuses ?? [])])].sort();

test('merging same-name tests: status and shown statuses are independent of entry order (xdist may interleave phases)', () => {
  for (const entries of sequences()) {
    const baseline = parsePytestJunitXml(xmlOf(entries)).tests;
    const byName = (tests: typeof baseline) => Object.fromEntries(tests.map(t => [t.name, [t.status, shown(t)]]));
    for (const order of permutations(entries)) {
      assert.deepEqual(
        byName(parsePytestJunitXml(xmlOf(order)).tests),
        byName(baseline),
        `order changed the merged result for ${JSON.stringify(entries)} vs ${JSON.stringify(order)}`,
      );
    }
  }
});

test('merging same-name tests: never downgrades, never hides a status, one test per name in first-seen order', () => {
  for (const entries of sequences()) {
    const merged = parsePytestJunitXml(xmlOf(entries)).tests;
    const names = [...new Set(entries.map(e => e.key))];
    assert.deepEqual(merged.map(t => t.name), names);
    for (const test of merged) {
      const members = entries.filter(e => e.key === test.name).map(e => e.status);
      assert.ok(members.every(s => RANK[s] <= RANK[test.status]), `downgrade for ${JSON.stringify(entries)}`);
      for (const s of members) assert.ok(shown(test).includes(s), `${s} hidden for ${JSON.stringify(entries)}`);
      if (members.includes('failed')) assert.equal(test.status, 'failed');
    }
    assert.equal(Object.values(testCounts({ tests: merged })).reduce((a, b) => a + b, 0), names.length);
  }
});

// decideCheck is pure: evidence in, verdict out. The oracle below is the intended precedence.
const rules = {
  testsPass: defineRule({ id: 'testing/tests-pass', description: 'p' }),
  noSkippedTests: defineRule({ id: 'testing/no-skipped-tests', description: 's' }),
  noXfailTests: defineRule({ id: 'testing/no-xfail-tests', description: 'x' }),
};
const TIMES = { startedAt: '1970-01-01T00:00:00.000Z', finishedAt: '1970-01-01T00:00:00.000Z' };
const BANNER = '!!!!!!!!!!!!!!!!!!!!!!!!!! stopping after 1 failures !!!!!!!!!!!!!!!!!!!!!!!!!!!';
const REPORTS: readonly (readonly Entry[])[] = [
  [{ key: 'a', status: 'passed' }],
  [{ key: 'a', status: 'failed' }],
  [{ key: 'a', status: 'failed' }, { key: 'b', status: 'skipped' }],
  [{ key: 'a', status: 'failed' }, { key: 'b', status: 'xfail' }],
  [{ key: 'a', status: 'skipped' }],
  [{ key: 'a', status: 'xfail' }],
];

test('decideCheck precedence: a breach FAILs; else an incomplete run REFUSES an absence rule; testsPass is never refused for it', () => {
  const subsets = [['testsPass'], ['noSkippedTests'], ['noXfailTests'], ['testsPass', 'noSkippedTests'], ['noSkippedTests', 'noXfailTests'], ['testsPass', 'noSkippedTests', 'noXfailTests']] as const;
  for (const entries of REPORTS) for (const selected of subsets) for (const stdout of ['', BANNER]) for (const exitCode of [0, 1, 2, 3]) {
    const execution: TestRunnerCompleted = { kind: 'completed', exitCode, stdout, stderr: '' };
    const picked = Object.fromEntries(selected.map(name => [name, rules[name]]));
    const outcome = decideCheck({
      times: TIMES,
      format: pytestJunitXml(),
      rules: picked,
      evidence: { kind: 'completed', execution, root: '/r', report: xmlOf(entries) },
    });

    const statuses = entries.map(e => e.status);
    const failed = statuses.includes('failed');
    const breach = (selected as readonly string[]).includes('testsPass') && failed
      || (selected as readonly string[]).includes('noSkippedTests') && statuses.includes('skipped')
      || (selected as readonly string[]).includes('noXfailTests') && statuses.includes('xfail');
    const incomplete = exitCode === 2 || exitCode === 3 || stdout === BANNER;
    const absence = selected.some(s => s !== 'testsPass');
    const unexplainedExit = exitCode !== 0 && !failed;
    const expected = unexplainedExit ? 'refuse' : breach ? 'fail' : incomplete && absence ? 'refuse' : 'pass';
    assert.equal(outcome.verdict, expected, `${JSON.stringify({ statuses, selected, stdout: stdout ? 'banner' : '', exitCode })}`);
  }
});
