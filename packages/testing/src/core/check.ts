import {
  rejectUnknownKeys,
  result,
  type CheckResult,
  type RefuseResult,
  type Rule,
  type RuleRef,
  type Scan,
} from 'redproof';
import {
  testCounts,
  testRunBreaches,
  type TestReportFormat,
  type TestRun,
  type TestRunnerCompleted,
  type TestRunnerUnavailable,
  type TestRuleOptions,
  type TestRunner,
} from './model.ts';
import { normalizeRun } from './normalize.ts';

export type TestingAdapterOptions<O extends TestRuleOptions> = {
  readonly runner: TestRunner;
  readonly report: TestReportFormat;
  readonly rules: O;
};

export type SelectedTestRules<R extends RuleRef> = {
  readonly testsPass?: Rule<R>;
  readonly noFlakyTests?: Rule<R>;
  readonly noSkippedTests?: Rule<R>;
  readonly noTodoTests?: Rule<R>;
};

/** Stamped by the shell around the run. */
export type ScanTimes = {
  readonly startedAt: string;
  readonly finishedAt: string;
};

export type CheckEvidence =
  | TestRunnerUnavailable
  | {
      readonly kind: 'completed';
      readonly execution: TestRunnerCompleted;
      /** The Gate root with symbolic links resolved. */
      readonly root: string;
      /** The report file content, or why it could not be read. */
      readonly report: string | Error;
    };

const TEST_RULE_NAMES = ['testsPass', 'noFlakyTests', 'noSkippedTests', 'noTodoTests'] as const;

export function validateTestingOptions(options: TestingAdapterOptions<TestRuleOptions>): void {
  rejectUnknownKeys(options, ['runner', 'report', 'rules'], 'testing adapter');
  rejectUnknownKeys(options.rules, TEST_RULE_NAMES, 'testing rule');

  if (
    !options.rules.testsPass
    && !options.rules.noFlakyTests
    && !options.rules.noSkippedTests
    && !options.rules.noTodoTests
  ) {
    throw new Error('Testing adapter requires at least one Redproof rule.');
  }

  if (options.rules.noFlakyTests && !options.report.capabilities.flaky) {
    throw new Error(`Report format ${options.report.kind} cannot distinguish flaky tests.`);
  }

  if (options.rules.noTodoTests && !options.report.capabilities.todo) {
    throw new Error(`Report format ${options.report.kind} cannot distinguish TODO tests.`);
  }
}

export function testRuleCatalog(rules: TestRuleOptions): Readonly<Record<string, Rule>> {
  const catalog: Record<string, Rule> = {};
  if (rules.testsPass) {
    catalog.testsPass = {
      id: 'testing/tests-pass',
      description: 'All tests must pass.',
    };
  }
  if (rules.noFlakyTests) {
    catalog.noFlakyTests = {
      id: 'testing/no-flaky-tests',
      description: 'Tests must pass without failed attempts.',
    };
  }
  if (rules.noSkippedTests) {
    catalog.noSkippedTests = {
      id: 'testing/no-skipped-tests',
      description: 'Tests must not be skipped.',
    };
  }
  if (rules.noTodoTests) {
    catalog.noTodoTests = {
      id: 'testing/no-todo-tests',
      description: 'Tests must not be marked TODO.',
    };
  }
  return catalog;
}

export function selectTestRules<R extends RuleRef>(
  options: TestRuleOptions,
  byAlias: Readonly<Record<string, Rule<R>>>,
): SelectedTestRules<R> {
  return {
    ...(options.testsPass ? { testsPass: byAlias.testsPass! } : {}),
    ...(options.noFlakyTests ? { noFlakyTests: byAlias.noFlakyTests! } : {}),
    ...(options.noSkippedTests ? { noSkippedTests: byAlias.noSkippedTests! } : {}),
    ...(options.noTodoTests ? { noTodoTests: byAlias.noTodoTests! } : {}),
  };
}

function scanOf(format: TestReportFormat, times: ScanTimes, inspected: number | null): Scan {
  return { source: `testing/${format.kind}`, ...times, inspected };
}

function detailOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function refuseTestRunnerUnavailable(
  format: TestReportFormat,
  times: ScanTimes,
  message: string,
  error: unknown,
): RefuseResult {
  return result.refuse(scanOf(format, times, null), {
    code: 'test-runner-unavailable',
    message,
    location: null,
    detail: detailOf(error),
  });
}

function parseReport(root: string, report: string | Error, format: TestReportFormat): TestRun | Error {
  if (report instanceof Error) return report;
  try {
    return normalizeRun(root, format.parse(report));
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

export function decideCheck<R extends RuleRef>(input: {
  readonly times: ScanTimes;
  readonly evidence: CheckEvidence;
  readonly format: TestReportFormat;
  readonly rules: SelectedTestRules<R>;
}): CheckResult<R> {
  const { times, evidence, format, rules } = input;
  if (evidence.kind === 'unavailable') {
    return result.refuse(scanOf(format, times, null), {
      code: 'test-runner-unavailable',
      message: evidence.message,
      location: null,
      ...(evidence.detail ? { detail: evidence.detail } : {}),
    });
  }

  const { execution } = evidence;
  const run = parseReport(evidence.root, evidence.report, format);
  if (run instanceof Error) {
    return result.refuse(scanOf(format, times, null), {
      code: 'test-report-unavailable',
      message: 'The test command did not produce a trustworthy structured report.',
      location: null,
      detail: [
        run.message,
        execution.stderr.trim(),
        execution.stdout.trim(),
        `exit code: ${execution.exitCode}`,
      ].filter(Boolean).join('\n'),
    });
  }

  if (execution.exitCode !== 0 && testCounts(run).failed === 0) {
    return result.refuse(scanOf(format, times, run.tests.length), {
      code: 'test-runner-unsuccessful',
      message: 'The test command exited unsuccessfully without structured failed tests explaining the exit.',
      location: null,
      detail: [
        execution.stderr.trim(),
        execution.stdout.trim(),
        `exit code: ${execution.exitCode}`,
      ].filter(Boolean).join('\n'),
    });
  }

  return result.fromBreaches(scanOf(format, times, run.tests.length), testRunBreaches(run, rules));
}
