import assert from 'node:assert/strict';
import test from 'node:test';
import { jestJson, parseJestJson } from '../../packages/testing/src/reports/jest-json.ts';
import { junitXml, parseJunitXml } from '../../packages/testing/src/reports/junit-xml.ts';

type Assertion = Record<string, unknown>;

function jestReport(assertions: readonly Assertion[], summary: Record<string, unknown> = {}): string {
  return JSON.stringify({
    ...summary,
    testResults: [{ name: '/repo/test/parser.test.ts', assertionResults: assertions }],
  });
}

function junitReport(testcases: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>\n<testsuites>\n<testsuite name="suite">\n${testcases}\n</testsuite>\n</testsuites>`;
}

test('Jest-compatible JSON maps every producer status onto passed, failed, skipped, or todo', () => {
  const run = parseJestJson(jestReport([
    { title: 'a', status: 'passed' },
    { title: 'b', status: 'failed', failureMessages: ['boom'] },
    { title: 'c', status: 'todo' },
    { title: 'd', status: 'pending' },
    { title: 'e', status: 'skipped' },
    { title: 'f', status: 'disabled' },
  ]));

  assert.deepEqual(
    run.tests.map(item => item.status),
    ['passed', 'failed', 'todo', 'skipped', 'skipped', 'skipped'],
  );
});

test('Jest-compatible JSON rejects a status it cannot map instead of guessing', () => {
  assert.throws(
    () => parseJestJson(jestReport([{ title: 'a', status: 'flaky' }])),
    /Unsupported Jest-compatible test status: flaky\./,
  );
  assert.throws(
    () => parseJestJson(jestReport([{ title: 'a' }])),
    /Unsupported Jest-compatible test status: undefined\./,
  );
});

test('Jest-compatible JSON names a test by its title, then its full name, then a placeholder', () => {
  const run = parseJestJson(jestReport([
    { title: 'by title', fullName: 'Suite by title', status: 'passed' },
    { fullName: '  Suite by full name  ', status: 'passed' },
    { status: 'passed' },
  ]));

  assert.deepEqual(run.tests.map(item => item.name), ['by title', 'Suite by full name', '<unnamed test>']);
});

test('Jest-compatible JSON keeps the suite path without blank ancestors and locates tests in their file', () => {
  const run = parseJestJson(jestReport([
    { title: 'a', status: 'passed', ancestorTitles: ['', 'Parser', ''], location: { line: 10, column: 3 }, duration: 2 },
    { title: 'b', status: 'passed', location: { line: 20 }, duration: null },
    { title: 'c', status: 'passed' },
  ]));

  assert.deepEqual(run.tests[0]?.suite, ['Parser']);
  assert.deepEqual(run.tests[0]?.location, { file: '/repo/test/parser.test.ts', line: 10, column: 3 });
  assert.equal(run.tests[0]?.durationMs, 2);
  assert.deepEqual(run.tests[1]?.suite, []);
  assert.deepEqual(run.tests[1]?.location, { file: '/repo/test/parser.test.ts', line: 20, column: null });
  assert.equal(run.tests[1]?.durationMs, undefined);
  assert.deepEqual(run.tests[2]?.location, { file: '/repo/test/parser.test.ts', line: null, column: null });
  assert.equal(run.tests[0]?.file, '/repo/test/parser.test.ts');
});

test('Jest-compatible JSON has no location when the producer names no file', () => {
  const run = parseJestJson(JSON.stringify({
    testResults: [{ assertionResults: [{ title: 'a', status: 'failed', failureMessages: ['x'], location: { line: 1, column: 1 } }] }],
  }));

  assert.equal(run.tests[0]?.file, null);
  assert.equal(run.tests[0]?.location, null);
});

test('Jest-compatible JSON joins failure messages with a blank line and drops empty ones', () => {
  const run = parseJestJson(jestReport([
    { title: 'a', status: 'failed', failureMessages: ['first', '', 'second'] },
    { title: 'b', status: 'failed', failureMessages: [] },
    { title: 'c', status: 'passed', failureMessages: [] },
  ]));

  assert.equal(run.tests[0]?.failure?.message, 'first\n\nsecond');
  assert.equal(run.tests[1]?.failure, undefined);
  assert.equal(run.tests[2]?.failure, undefined);
});

test('a passing test keeps the failure evidence of its earlier attempts', () => {
  const run = parseJestJson(jestReport([
    { title: 'kept messages', status: 'passed', failureMessages: ['expected attempt 1 to succeed'] },
    { title: 'retry reasons', status: 'passed', failureMessages: [], retryReasons: ['', 'flaky network', 'timeout'] },
    { title: 'counted attempts', status: 'passed', failureMessages: [], retryReasons: [], invocations: 3 },
    { title: 'one attempt', status: 'passed', failureMessages: [], retryReasons: [], invocations: 1 },
    { title: 'no attempt count', status: 'passed', failureMessages: [] },
  ]));

  assert.equal(run.tests[0]?.failure?.message, 'expected attempt 1 to succeed');
  assert.equal(run.tests[1]?.failure?.message, 'flaky network\n\ntimeout');
  assert.equal(run.tests[2]?.failure?.message, 'passed after 3 invocations');
  assert.equal(run.tests[3]?.failure, undefined);
  assert.equal(run.tests[4]?.failure, undefined);
});

test('kept failure messages outrank retry reasons, which outrank the attempt count', () => {
  const run = parseJestJson(jestReport([
    { title: 'a', status: 'passed', failureMessages: ['kept'], retryReasons: ['reason'], invocations: 2 },
    { title: 'b', status: 'passed', failureMessages: [], retryReasons: ['reason'], invocations: 2 },
  ]));

  assert.equal(run.tests[0]?.failure?.message, 'kept');
  assert.equal(run.tests[1]?.failure?.message, 'reason');
});

test('Jest-compatible JSON refuses a total or failed count that contradicts the assertions', () => {
  const assertions: Assertion[] = [
    { title: 'a', status: 'passed' },
    { title: 'b', status: 'failed', failureMessages: ['x'] },
    { title: 'c', status: 'pending' },
    { title: 'd', status: 'todo' },
  ];
  const consistent = { numTotalTests: 4, numPassedTests: 1, numFailedTests: 1, numPendingTests: 1, numTodoTests: 1 };
  assert.equal(parseJestJson(jestReport(assertions, consistent)).tests.length, 4);

  assert.throws(
    () => parseJestJson(jestReport(assertions, { ...consistent, numTotalTests: 5 })),
    /numTotalTests is 5, but assertionResults contain 4\./,
  );
  assert.throws(
    () => parseJestJson(jestReport(assertions, { ...consistent, numFailedTests: 0 })),
    /numFailedTests is 0, but assertionResults contain 1\./,
  );
});

test('only the total and failed counts are trusted; passed, pending, and todo counts vary by producer', () => {
  const assertions: Assertion[] = [
    { title: 'a', status: 'passed' },
    { title: 'b', status: 'failed', failureMessages: ['x'] },
    { title: 'c', status: 'pending' },
  ];

  for (const field of ['numPassedTests', 'numPendingTests', 'numTodoTests']) {
    const run = parseJestJson(jestReport(assertions, { numTotalTests: 3, numFailedTests: 1, [field]: 99 }));
    assert.deepEqual(run.tests.map(item => item.status), ['passed', 'failed', 'skipped'], field);
  }
});

test('a bailed run whose pending count is zero still keeps its never-run tests as skipped', () => {
  const run = parseJestJson(jestReport(
    [
      { title: 'a passes', status: 'passed' },
      { title: 'b fails', status: 'failed', failureMessages: ['expected 1 to be 2'] },
      { title: 'c never ran', status: 'pending' },
    ],
    { numTotalTests: 3, numPassedTests: 1, numFailedTests: 1, numPendingTests: 0, numTodoTests: 0 },
  ));

  assert.deepEqual(run.tests.map(item => item.status), ['passed', 'failed', 'skipped']);
});

test('every summary count must be a non-negative safe integer when present', () => {
  const assertions: Assertion[] = [{ title: 'a', status: 'passed' }];

  for (const field of ['numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests', 'numTodoTests']) {
    for (const bad of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1']) {
      assert.throws(
        () => parseJestJson(jestReport(assertions, { [field]: bad })),
        new RegExp(`${field} must be a non-negative safe integer\\.`),
        `${field} = ${String(bad)}`,
      );
    }
  }
  assert.equal(parseJestJson(jestReport(assertions, { numTotalTests: 1, numPassedTests: 0 })).tests.length, 1);
});

test('Jest-compatible JSON rejects a report without result lists', () => {
  assert.throws(() => parseJestJson('{}'), /missing testResults/);
  assert.throws(() => parseJestJson('{"testResults": {}}'), /missing testResults/);
  assert.throws(
    () => parseJestJson(JSON.stringify({ testResults: [{ name: 'f' }] })),
    /missing assertionResults/,
  );
  assert.throws(() => parseJestJson('not json'), SyntaxError);
  assert.deepEqual(parseJestJson('{"testResults": []}'), { tests: [] });
});

test('JUnit XML maps a failure or error child to failed, a skipped child to skipped, and nothing to passed', () => {
  const run = parseJunitXml(junitReport(`
    <testcase classname="test_parser" name="test_ok" time="0.001" />
    <testcase classname="test_parser" name="test_bad" time="0.002">
      <failure message="assert 1 == 2">test_parser.py:8: AssertionError</failure>
    </testcase>
    <testcase classname="test_parser" name="test_error"><error message="boom"/></testcase>
    <testcase classname="test_parser" name="test_skip" time="0.000">
      <skipped type="pytest.skip" message="later">later</skipped>
    </testcase>
    <testcase classname="test_parser" name="test_empty"></testcase>
  `));

  assert.deepEqual(run.tests.map(item => item.status), ['passed', 'failed', 'failed', 'skipped', 'passed']);
  assert.deepEqual(run.tests.map(item => item.name), ['test_ok', 'test_bad', 'test_error', 'test_skip', 'test_empty']);
  assert.deepEqual(run.tests[1]?.suite, ['test_parser']);
  assert.equal(run.tests[1]?.failure?.message, 'assert 1 == 2');
  assert.equal(run.tests[1]?.failure?.detail, 'test_parser.py:8: AssertionError');
  assert.equal(run.tests[2]?.failure?.message, 'boom');
  assert.equal(run.tests[2]?.failure?.detail, undefined);
  assert.equal(run.tests[3]?.failure, undefined);
});

test('JUnit XML falls back from the failure message attribute to the body, then to a fixed sentence', () => {
  const run = parseJunitXml(junitReport(`
    <testcase name="body"><failure>only the body</failure></testcase>
    <testcase name="empty"><failure/></testcase>
  `));

  assert.equal(run.tests[0]?.failure?.message, 'only the body');
  assert.equal(run.tests[0]?.failure?.detail, 'only the body');
  assert.equal(run.tests[1]?.failure?.message, 'Test failed.');
  assert.equal(run.tests[1]?.failure?.detail, undefined);
});

test('JUnit XML reads the file and line attributes as the location and converts seconds to milliseconds', () => {
  const run = parseJunitXml(junitReport(`
    <testcase name="located" file="tests/test_parser.py" line="12" time="0.25"/>
    <testcase name="file only" file='tests/test_parser.py'/>
    <testcase name="unplaced" line="3" time="fast"/>
  `));

  assert.deepEqual(run.tests[0]?.location, { file: 'tests/test_parser.py', line: 12, column: null });
  assert.equal(run.tests[0]?.file, 'tests/test_parser.py');
  assert.equal(run.tests[0]?.durationMs, 250);
  assert.deepEqual(run.tests[1]?.location, { file: 'tests/test_parser.py', line: null, column: null });
  assert.deepEqual(run.tests[1]?.suite, []);
  assert.equal(run.tests[2]?.location, null);
  assert.equal(run.tests[2]?.file, null);
  assert.equal(run.tests[2]?.durationMs, undefined);
});

test('JUnit XML decodes named, decimal, and hexadecimal character references', () => {
  const run = parseJunitXml(`<testsuite name="entities">
    <testcase classname="suite" name="it&#x27;s safe">
      <failure message="&#60;bad&#62; &amp; &#128640;">at &#x3C;anonymous&#x3E; &quot;q&quot; &apos;a&apos;</failure>
    </testcase>
  </testsuite>`);

  assert.equal(run.tests[0]?.name, "it's safe");
  assert.equal(run.tests[0]?.failure?.message, '<bad> & 🚀');
  assert.equal(run.tests[0]?.failure?.detail, 'at <anonymous> "q" \'a\'');
});

test('JUnit XML leaves out-of-range and surrogate references undecoded', () => {
  const run = parseJunitXml(`<testsuite name="entities">
    <testcase classname="suite" name="over &#x110000; and lone &#xD800;"/>
  </testsuite>`);

  assert.equal(run.tests[0]?.name, 'over &#x110000; and lone &#xD800;');
});

test('JUnit XML does not decode an escaped character reference twice', () => {
  const run = parseJunitXml(`<testsuite name="entities">
    <testcase classname="suite" name="literal &amp;#60;tag&amp;#62; and &amp;lt;"/>
  </testsuite>`);

  assert.equal(run.tests[0]?.name, 'literal &#60;tag&#62; and &lt;');
});

test('JUnit XML accepts an empty suite but rejects a document without a suite root or with an unreadable testcase', () => {
  assert.deepEqual(parseJunitXml('<testsuites/>'), { tests: [] });
  assert.deepEqual(parseJunitXml('<testsuite name="empty"></testsuite>'), { tests: [] });
  assert.throws(
    () => parseJunitXml('<results><testcase name="a"/></results>'),
    /missing testsuite\/testsuites root content/,
  );
  assert.throws(
    () => parseJunitXml('<testsuite><testcase name="unterminated"></testsuite>'),
    /testcase elements that could not be parsed/,
  );
});

test('each report format declares which test semantics it can see', () => {
  const jest = jestJson();
  const junit = junitXml();

  assert.equal(jest.kind, 'jest-json');
  assert.equal(jest.extension, '.json');
  assert.deepEqual(jest.capabilities, { todo: true, flaky: true });
  assert.equal(jest.parse, parseJestJson);

  assert.equal(junit.kind, 'junit-xml');
  assert.equal(junit.extension, '.xml');
  assert.deepEqual(junit.capabilities, { todo: false, flaky: false });
  assert.equal(junit.parse, parseJunitXml);
});
