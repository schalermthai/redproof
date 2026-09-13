import type { TestCase, TestReportFormat, TestRun, TestStatus } from '../model.ts';

type JestAssertionLike = {
  readonly ancestorTitles?: readonly string[];
  readonly fullName?: string;
  readonly status?: string;
  readonly title?: string;
  readonly duration?: number | null;
  readonly failureMessages?: readonly string[];
  /** Jest fills retryReasons only with logErrorsBeforeRetry; invocations counts every attempt. */
  readonly retryReasons?: readonly string[];
  readonly invocations?: number;
  readonly location?: {
    readonly line?: number;
    readonly column?: number;
  } | null;
};

type JestFileLike = {
  readonly name?: string;
  readonly assertionResults?: readonly JestAssertionLike[];
};

type JestReportLike = {
  readonly numTotalTests?: number;
  readonly numPassedTests?: number;
  readonly numFailedTests?: number;
  readonly numPendingTests?: number;
  readonly numTodoTests?: number;
  readonly testResults?: readonly JestFileLike[];
};

type JestSummaryField = Exclude<keyof JestReportLike, 'testResults'>;

const SUMMARY_FIELDS: readonly JestSummaryField[] = [
  'numTotalTests',
  'numPassedTests',
  'numFailedTests',
  'numPendingTests',
  'numTodoTests',
];

/** Only total and failed agree with assertionResults across Vitest versions and under bail. */
function validateSummary(parsed: JestReportLike, tests: readonly TestCase[]): void {
  for (const field of SUMMARY_FIELDS) {
    const reported = parsed[field];
    if (reported === undefined) continue;
    if (!Number.isSafeInteger(reported) || reported < 0) {
      throw new Error(`Jest-compatible JSON ${field} must be a non-negative safe integer.`);
    }
  }

  const expected = {
    numTotalTests: tests.length,
    numFailedTests: tests.filter(test => test.status === 'failed').length,
  } as const;

  for (const field of Object.keys(expected) as (keyof typeof expected)[]) {
    const reported = parsed[field];
    if (reported !== undefined && reported !== expected[field]) {
      throw new Error(
        `Jest-compatible JSON ${field} is ${reported}, but assertionResults contain ${expected[field]}.`,
      );
    }
  }
}

function statusOf(status: string | undefined): TestStatus {
  switch (status) {
    case 'passed':
      return 'passed';
    case 'failed':
      return 'failed';
    case 'todo':
      return 'todo';
    case 'pending':
    case 'skipped':
    case 'disabled':
      return 'skipped';
    default:
      throw new Error(`Unsupported Jest-compatible test status: ${String(status)}.`);
  }
}

export function parseJestJson(input: string): TestRun {
  const parsed = JSON.parse(input) as JestReportLike;
  if (!Array.isArray(parsed.testResults)) {
    throw new Error('Jest-compatible JSON report is missing testResults.');
  }

  const tests: TestCase[] = [];

  for (const file of parsed.testResults) {
    if (!Array.isArray(file.assertionResults)) {
      throw new Error('Jest-compatible JSON test result is missing assertionResults.');
    }

    for (const assertion of file.assertionResults) {
      const status = statusOf(assertion.status);
      const failureMessage = assertion.failureMessages?.filter(Boolean).join('\n\n');
      const retryReasons = assertion.retryReasons?.filter(Boolean).join('\n\n');
      const retried = typeof assertion.invocations === 'number' && assertion.invocations > 1;
      const evidence = failureMessage
        || retryReasons
        || (retried ? `passed after ${assertion.invocations} invocations` : '');
      const line = assertion.location?.line ?? null;
      const column = assertion.location?.column ?? null;
      const location = file.name
        ? { file: file.name, line, column }
        : null;

      tests.push({
        name: assertion.title ?? assertion.fullName?.trim() ?? '<unnamed test>',
        suite: (assertion.ancestorTitles ?? []).filter(Boolean),
        file: file.name ?? null,
        status,
        location,
        ...(typeof assertion.duration === 'number' ? { durationMs: assertion.duration } : {}),
        ...(evidence
          ? { failure: { message: evidence } }
          : {}),
      });
    }
  }

  validateSummary(parsed, tests);
  return { tests };
}

export function jestJson(): TestReportFormat {
  return {
    kind: 'jest-json',
    extension: '.json',
    capabilities: { todo: true, flaky: true },
    parse: parseJestJson,
  };
}
