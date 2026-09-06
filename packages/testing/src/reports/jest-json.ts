import type { TestCase, TestReportFormat, TestRun, TestStatus } from '../model.ts';

type JestAssertionLike = {
  readonly ancestorTitles?: readonly string[];
  readonly fullName?: string;
  readonly status?: string;
  readonly title?: string;
  readonly duration?: number | null;
  readonly failureMessages?: readonly string[];
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
  readonly testResults?: readonly JestFileLike[];
};

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
        ...(failureMessage
          ? { failure: { message: failureMessage } }
          : {}),
      });
    }
  }

  return { tests };
}

export function jestJson(): TestReportFormat {
  return {
    kind: 'jest-json',
    extension: '.json',
    capabilities: { todo: true },
    parse: parseJestJson,
  };
}
