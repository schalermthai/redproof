import {
  breach,
  type Breach,
  type Diagnostic,
  type Location,
  type Rule,
  type RuleRef,
} from 'redproof';

export type TestStatus = 'passed' | 'failed' | 'skipped' | 'todo' | 'xfail';

export type TestFailure = {
  readonly message: string;
  readonly detail?: string;
  readonly comparison?: {
    readonly expected: string;
    readonly actual: string;
  };
};

export type TestCase = {
  readonly name: string;
  readonly suite: readonly string[];
  readonly file: string | null;
  readonly status: TestStatus;
  readonly location: Location | null;
  readonly durationMs?: number;
  readonly failure?: TestFailure;
  /** Other statuses this test showed besides `status` (a skip that also errored in teardown). */
  readonly alsoStatuses?: readonly TestStatus[];
};

/** Whether a test showed `status`, as its main status or as an extra one. */
function showedStatus(test: TestCase, status: TestStatus): boolean {
  return test.status === status || (test.alsoStatuses?.includes(status) ?? false);
}

export type TestRun = {
  readonly tests: readonly TestCase[];
};

export type TestRuleOptions = {
  readonly testsPass?: true;
  readonly noFlakyTests?: true;
  readonly noSkippedTests?: true;
  readonly noTodoTests?: true;
  readonly noXfailTests?: true;
};

export type TestRuleCatalog<O extends TestRuleOptions> = {
  readonly [K in keyof O]:
    K extends 'testsPass'
      ? Rule<'testing/tests-pass'>
      : K extends 'noFlakyTests'
        ? Rule<'testing/no-flaky-tests'>
        : K extends 'noSkippedTests'
          ? Rule<'testing/no-skipped-tests'>
          : K extends 'noTodoTests'
            ? Rule<'testing/no-todo-tests'>
            : K extends 'noXfailTests'
              ? Rule<'testing/no-xfail-tests'>
              : never;
};

export type TestReportCapabilities = {
  readonly todo: boolean;
  /** Whether a known-failing (expected failure) test is distinct from a skipped one. */
  readonly xfail?: boolean;
  /** Whether a passing test preserves failure evidence from earlier attempts. */
  readonly flaky?: boolean;
};

export type TestReportFormat = {
  readonly kind: string;
  readonly extension: string;
  readonly capabilities: TestReportCapabilities;
  parse(input: string): TestRun;
  /**
   * Why the run stopped before every test ran, or null. A rule that claims something never
   * happened (no skips, no xfails) cannot be decided on such a run.
   */
  incomplete?(evidence: {
    readonly run: TestRun;
    readonly stdout: string;
    readonly exitCode: number;
  }): string | null;
};

export type TestRunnerContext = {
  readonly root: string;
  readonly reportFile: string;
};

export type TestRunnerCompleted = {
  readonly kind: 'completed';
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

export type TestRunnerUnavailable = {
  readonly kind: 'unavailable';
  readonly message: string;
  readonly detail?: string;
};

export type TestRunnerResult = TestRunnerCompleted | TestRunnerUnavailable;

export type CommandPlan = {
  readonly command: string;
  /** Absent when the arguments are computed from the run context. */
  readonly args?: readonly string[];
};

export type TestRunner = {
  readonly description: string;
  /** What this runner will execute, known without a run. */
  readonly plan?: CommandPlan;
  /** The exact arguments for one run. Present on command runners. */
  argsFor?(ctx: TestRunnerContext): readonly string[];
  run(ctx: TestRunnerContext): Promise<TestRunnerResult>;
};

function displayName(test: TestCase): string {
  return [...test.suite, test.name].filter(Boolean).join(' > ');
}

function testDiagnostic(test: TestCase, code: string, message: string): Diagnostic {
  const failure = test.failure;
  return {
    code,
    message,
    location: test.location,
    ...(failure?.comparison ? { comparison: failure.comparison } : {}),
    ...(failure ? { detail: failure.detail ?? failure.message } : {}),
  };
}

export function testRunBreaches<R extends RuleRef>(
  run: TestRun,
  rules: {
    readonly testsPass?: Rule<R>;
    readonly noFlakyTests?: Rule<R>;
    readonly noSkippedTests?: Rule<R>;
    readonly noTodoTests?: Rule<R>;
    readonly noXfailTests?: Rule<R>;
  },
): readonly Breach<R>[] {
  const breaches: Breach<R>[] = [];

  if (rules.testsPass) {
    for (const test of run.tests.filter(item => item.status === 'failed')) {
      breaches.push(breach(
        rules.testsPass,
        testDiagnostic(test, 'test-failed', displayName(test)),
      ));
    }
  }

  if (rules.noFlakyTests) {
    for (const test of run.tests.filter(item => item.status === 'passed' && item.failure)) {
      breaches.push(breach(
        rules.noFlakyTests,
        testDiagnostic(test, 'test-flaky', displayName(test)),
      ));
    }
  }

  if (rules.noSkippedTests) {
    for (const test of run.tests.filter(item => showedStatus(item, 'skipped'))) {
      breaches.push(breach(rules.noSkippedTests, {
        code: 'test-skipped',
        message: displayName(test),
        location: test.location,
      }));
    }
  }

  if (rules.noTodoTests) {
    for (const test of run.tests.filter(item => showedStatus(item, 'todo'))) {
      breaches.push(breach(rules.noTodoTests, {
        code: 'test-todo',
        message: displayName(test),
        location: test.location,
      }));
    }
  }

  if (rules.noXfailTests) {
    for (const test of run.tests.filter(item => showedStatus(item, 'xfail'))) {
      breaches.push(breach(rules.noXfailTests, {
        code: 'test-xfail',
        message: displayName(test),
        location: test.location,
      }));
    }
  }

  return breaches;
}

export function testCounts(run: TestRun): Readonly<Record<TestStatus, number>> {
  return {
    passed: run.tests.filter(test => test.status === 'passed').length,
    failed: run.tests.filter(test => test.status === 'failed').length,
    skipped: run.tests.filter(test => test.status === 'skipped').length,
    todo: run.tests.filter(test => test.status === 'todo').length,
    xfail: run.tests.filter(test => test.status === 'xfail').length,
  };
}
