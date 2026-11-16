import type { TestCase, TestReportFormat, TestRun, TestStatus } from '../model.ts';

function decodeXml(value: string): string {
  return value
    .replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (reference, hex, decimal) => {
      const codePoint = Number.parseInt(hex ?? decimal, hex ? 16 : 10);
      return codePoint <= 0x10FFFF && !(codePoint >= 0xD800 && codePoint <= 0xDFFF)
        ? String.fromCodePoint(codePoint)
        : reference;
    })
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

function attributes(raw: string): Readonly<Record<string, string>> {
  const attrs: Record<string, string> = {};
  const re = /([:\w.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  for (let match = re.exec(raw); match; match = re.exec(raw)) {
    attrs[match[1]!] = decodeXml(match[3] ?? match[4] ?? '');
  }
  return attrs;
}

function element(body: string, name: string): { attrs: Readonly<Record<string, string>>; text: string } | null {
  const paired = new RegExp(`<${name}\\b([^>]*)>([\\s\\S]*?)<\\/${name}>`, 'i').exec(body);
  if (paired) {
    return { attrs: attributes(paired[1] ?? ''), text: decodeXml((paired[2] ?? '').trim()) };
  }

  const selfClosing = new RegExp(`<${name}\\b([^>]*)\\/>`, 'i').exec(body);
  if (selfClosing) {
    return { attrs: attributes(selfClosing[1] ?? ''), text: '' };
  }

  return null;
}

/**
 * pytest's banner when the run ends early: -x or --maxfail, a stepwise stop, or `pytest.exit()` (which can
 * exit 0, so the exit code alone is not enough). Whole line only, so captured test output can't forge it.
 * xdist adds a dotted module prefix (`xdist.dsession.Interrupted:`), `pytest.exit` is `_pytest.outcomes.Exit:`.
 */
const PYTEST_STOPPED_EARLY = /^!{3,} (?:stopping after \d+ failures?|(?:[\w.]*\.)?(?:Interrupted|Exit): .+) !{3,}$/mu;

/** pytest writes an expected failure as <skipped type="pytest.xfail">; no other tool does. */
const PYTEST_XFAIL_TYPE = 'pytest.xfail';

type JunitDialect = 'generic' | 'pytest';

function parseJunit(input: string, dialect: JunitDialect): TestRun {
  const tests: TestCase[] = [];
  const testcase = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/gi;

  for (let match = testcase.exec(input); match; match = testcase.exec(input)) {
    const attrs = attributes(match[1] ?? '');
    const body = match[2] ?? '';
    const failure = element(body, 'failure') ?? element(body, 'error');
    const skipped = element(body, 'skipped');
    const skipStatus: TestStatus = dialect === 'pytest' && skipped?.attrs.type === PYTEST_XFAIL_TYPE ? 'xfail' : 'skipped';
    let status: TestStatus = 'passed';
    if (failure) status = 'failed';
    else if (skipped) status = skipStatus;
    // pytest can write a skip AND a teardown error into one testcase; keep the skip visible.
    const alsoStatuses: readonly TestStatus[] = dialect === 'pytest' && failure && skipped ? [skipStatus] : [];
    const file = attrs.file ?? null;
    const rawLine = attrs.line ? Number.parseInt(attrs.line, 10) : null;
    // pytest's xunit1 family writes a 0-based line; Redproof locations are 1-based.
    const line = rawLine !== null && dialect === 'pytest' ? rawLine + 1 : rawLine;
    const durationSeconds = attrs.time ? Number.parseFloat(attrs.time) : Number.NaN;
    const suite = attrs.classname ? [attrs.classname] : [];

    tests.push({
      name: attrs.name ?? '<unnamed test>',
      suite,
      file,
      status,
      location: file ? { file, line: Number.isFinite(line) ? line : null, column: null } : null,
      ...(alsoStatuses.length > 0 ? { alsoStatuses } : {}),
      ...(Number.isFinite(durationSeconds) ? { durationMs: durationSeconds * 1000 } : {}),
      ...(failure
        ? {
            failure: {
              message: failure.attrs.message ?? (failure.text || 'Test failed.'),
              ...(failure.text ? { detail: failure.text } : {}),
            },
          }
        : {}),
    });
  }

  if (tests.length === 0 && /<testcase\b/i.test(input)) {
    throw new Error('JUnit XML report contains testcase elements that could not be parsed.');
  }

  if (!/<testsuites?\b/i.test(input)) {
    throw new Error('JUnit XML report is missing testsuite/testsuites root content.');
  }

  return { tests };
}

export function parseJunitXml(input: string): TestRun {
  return parseJunit(input, 'generic');
}

/** A strict total order, so the merged status never depends on entry order (ties would). */
const STATUS_RANK: Readonly<Record<TestStatus, number>> = {
  failed: 5,
  xfail: 4,
  todo: 3,
  skipped: 2,
  passed: 1,
};

/**
 * pytest writes one <testcase> per report phase that failed, so a failing call followed by a
 * teardown error is two elements with the same classname and name (and a retry plugin repeats
 * a passing one). Fold them into one test: the worst status wins, so a merge can never turn a
 * FAIL into a PASS, and every failure message is kept. Keyed over the whole report because
 * xdist can interleave the phases. The status and the statuses shown do not depend on entry
 * order; the primary failure message, detail and location follow the first entry.
 */
function mergeSameNameTests(tests: readonly TestCase[]): readonly TestCase[] {
  const order: string[] = [];
  const groups = new Map<string, TestCase[]>();
  for (const item of tests) {
    // xunit1 records each test's file; `a.b/x.py` and `a/b/x.py` share a dotted classname, so use it.
    const key = `${item.file ?? ''}\u0000${item.suite.join('.')}\u0000${item.name}`;
    const group = groups.get(key);
    if (group) group.push(item);
    else {
      groups.set(key, [item]);
      order.push(key);
    }
  }

  return order.map(key => {
    const group = groups.get(key)!;
    if (group.length === 1) return group[0]!;
    const winner = group.reduce((best, item) => (STATUS_RANK[item.status] > STATUS_RANK[best.status] ? item : best));
    const seen = [...new Set(group.flatMap(item => [item.status, ...(item.alsoStatuses ?? [])]))]
      .filter(status => status !== winner.status);
    const merged = seen.length > 0 ? { ...winner, alsoStatuses: seen } : winner;
    const failures = group.flatMap(item => (item.failure ? [item.failure] : []));
    if (failures.length === 0) return merged;
    const [first, ...rest] = failures as [NonNullable<TestCase['failure']>, ...NonNullable<TestCase['failure']>[]];
    const detail = [first.detail, ...rest.flatMap(extra => [extra.message, extra.detail])]
      .filter(Boolean)
      .join('\n\n');
    return {
      ...merged,
      failure: { message: first.message, ...(detail ? { detail } : {}) },
    };
  });
}

export function parsePytestJunitXml(input: string): TestRun {
  return { tests: mergeSameNameTests(parseJunit(input, 'pytest').tests) };
}

export function junitXml(): TestReportFormat {
  return {
    kind: 'junit-xml',
    extension: '.xml',
    capabilities: { todo: false, flaky: false },
    parse: parseJunitXml,
  };
}

/**
 * JUnit XML written by pytest. Unlike generic JUnit it can tell an expected failure
 * (xfail) from a skip. It cannot show retries, TODOs, or an unexpected pass.
 */
export function pytestJunitXml(): TestReportFormat {
  return {
    kind: 'pytest-junit-xml',
    extension: '.xml',
    capabilities: { todo: false, flaky: false, xfail: true },
    parse: parsePytestJunitXml,
    incomplete: ({ run, stdout, exitCode }) => {
      if (run.tests.some(test => test.failure?.message === 'collection failure')) {
        return 'A collection error stopped some test modules from being collected, so their tests never ran.';
      }
      if (exitCode === 2) return 'pytest was interrupted (exit code 2).';
      if (PYTEST_STOPPED_EARLY.test(stdout)) return 'pytest stopped early (-x or --maxfail), so later tests never ran.';
      return null;
    },
  };
}
