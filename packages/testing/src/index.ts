import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import {
  counting,
  defineAdapter,
  defineRules,
  result,
  type Adapter,
  type Location,
  rejectUnknownKeys,
  type NoUnknownKeys,
  type Rule,
  type RuleRefOfCatalog,
} from 'redproof';
import {
  testCounts,
  testRunBreaches,
  type TestCase,
  type TestReportFormat,
  type TestRuleCatalog,
  type TestRuleOptions,
  type TestRun,
  type TestRunner,
} from './model.ts';
import { command } from './runner.ts';
import { jestJson, parseJestJson } from './reports/jest-json.ts';
import { junitXml, parseJunitXml } from './reports/junit-xml.ts';
import { configuredVitestReport } from './shell/vitest-runner.ts';

export type TestingAdapterOptions<O extends TestRuleOptions> = {
  readonly runner: TestRunner;
  readonly report: TestReportFormat;
  readonly rules: O;
};

function now(): string {
  return new Date().toISOString();
}

function normalizeFile(root: string, file: string | null): string | null {
  if (!file) return null;
  if (!isAbsolute(file)) return file.replaceAll('\\', '/');
  const rel = relative(root, file);
  if (!rel.startsWith('..') && !isAbsolute(rel)) return rel.replaceAll('\\', '/');
  return file.replaceAll('\\', '/');
}

function normalizeLocation(root: string, location: Location | null): Location | null {
  if (!location) return null;
  return {
    ...location,
    file: normalizeFile(root, location.file) ?? location.file,
  };
}

function normalizeRun(root: string, run: TestRun): TestRun {
  return {
    tests: run.tests.map((test): TestCase => ({
      ...test,
      file: normalizeFile(root, test.file),
      location: normalizeLocation(root, test.location),
    })),
  };
}

const TEST_RULE_NAMES = ['testsPass', 'noFlakyTests', 'noSkippedTests', 'noTodoTests'] as const;

export function testing<const O extends TestRuleOptions>(
  options: TestingAdapterOptions<O> & { readonly rules: NoUnknownKeys<O, TestRuleOptions> },
): Adapter<TestRuleCatalog<O>> {
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

  const catalog: Record<string, Rule> = {};
  if (options.rules.testsPass) {
    catalog.testsPass = {
      id: 'testing/tests-pass',
      description: 'All tests must pass.',
    };
  }
  if (options.rules.noFlakyTests) {
    catalog.noFlakyTests = {
      id: 'testing/no-flaky-tests',
      description: 'Tests must pass without failed attempts.',
    };
  }
  if (options.rules.noSkippedTests) {
    catalog.noSkippedTests = {
      id: 'testing/no-skipped-tests',
      description: 'Tests must not be skipped.',
    };
  }
  if (options.rules.noTodoTests) {
    catalog.noTodoTests = {
      id: 'testing/no-todo-tests',
      description: 'Tests must not be marked TODO.',
    };
  }

  const rules = defineRules(catalog as TestRuleCatalog<O>);
  type Ref = RuleRefOfCatalog<TestRuleCatalog<O>>;
  const byAlias = rules as unknown as Readonly<Record<string, Rule<Ref>>>;

  return defineAdapter({
    kind: 'testing',
    rules,
    check: {
      description: `${options.runner.description}; interpret ${options.report.kind} test results`,
      counting: counting.supported,

      async run(ctx) {
        const startedAt = now();
        const temp = await mkdtemp(join(tmpdir(), 'redproof-testing-'));
        const reportFile = join(temp, `report${options.report.extension}`);

        try {
          const execution = await options.runner.run({ root: ctx.root, reportFile });
          if (execution.kind === 'unavailable') {
            return result.refuse(
              {
                source: `testing/${options.report.kind}`,
                startedAt,
                finishedAt: now(),
                inspected: null,
              },
              {
                code: 'test-runner-unavailable',
                message: execution.message,
                location: null,
                ...(execution.detail ? { detail: execution.detail } : {}),
              },
            );
          }

          let run: TestRun;
          try {
            const canonicalRoot = await realpath(ctx.root).catch(() => ctx.root);
            run = normalizeRun(canonicalRoot, options.report.parse(await readFile(reportFile, 'utf8')));
          } catch (error) {
            return result.refuse(
              {
                source: `testing/${options.report.kind}`,
                startedAt,
                finishedAt: now(),
                inspected: null,
              },
              {
                code: 'test-report-unavailable',
                message: 'The test command did not produce a trustworthy structured report.',
                location: null,
                detail: [
                  error instanceof Error ? error.message : String(error),
                  execution.stderr.trim(),
                  execution.stdout.trim(),
                  `exit code: ${execution.exitCode}`,
                ].filter(Boolean).join('\n'),
              },
            );
          }

          const counts = testCounts(run);

          if (execution.exitCode !== 0 && counts.failed === 0) {
            return result.refuse(
              {
                source: `testing/${options.report.kind}`,
                startedAt,
                finishedAt: now(),
                inspected: run.tests.length,
              },
              {
                code: 'test-runner-unsuccessful',
                message: 'The test command exited unsuccessfully without structured failed tests explaining the exit.',
                location: null,
                detail: [
                  execution.stderr.trim(),
                  execution.stdout.trim(),
                  `exit code: ${execution.exitCode}`,
                ].filter(Boolean).join('\n'),
              },
            );
          }

          const scan = {
            source: `testing/${options.report.kind}`,
            startedAt,
            finishedAt: now(),
            inspected: run.tests.length,
          } as const;

          return result.fromBreaches(
            scan,
            testRunBreaches(run, {
              ...(options.rules.testsPass ? { testsPass: byAlias.testsPass! } : {}),
              ...(options.rules.noFlakyTests ? { noFlakyTests: byAlias.noFlakyTests! } : {}),
              ...(options.rules.noSkippedTests ? { noSkippedTests: byAlias.noSkippedTests! } : {}),
              ...(options.rules.noTodoTests ? { noTodoTests: byAlias.noTodoTests! } : {}),
            }),
          );
        } finally {
          await rm(temp, { recursive: true, force: true });
        }
      },
    },
  });
}


export function defineTestRunner<const R extends TestRunner>(runner: R): R {
  return runner;
}

export function defineTestReport<const R extends TestReportFormat>(report: R): R {
  return report;
}

export type VitestAdapterOptions<O extends TestRuleOptions> = {
  readonly command?: string;
  /** Relative to the Gate root and confined inside it. Defaults to the root. */
  readonly cwd?: string;
  readonly configFile?: string;
  /** A JSON output file configured in Vitest, relative to cwd. */
  readonly reportFile?: string;
  readonly files?: readonly string[];
  readonly args?: readonly string[];
  readonly rules: O;
};

export function vitest<const O extends TestRuleOptions>(
  options: VitestAdapterOptions<O> & { readonly rules: NoUnknownKeys<O, TestRuleOptions> },
): Adapter<TestRuleCatalog<O>> {
  const cwd = options.cwd ?? '.';
  const runner = command({
    command: options.command ?? 'vitest',
    cwd,
    description: 'run Vitest',
    args: ({ reportFile }) => [
      'run',
      '--reporter=json',
      '--no-cache',
      ...(options.reportFile ? [] : [`--outputFile=${reportFile}`]),
      ...(options.configFile ? ['--config', options.configFile] : []),
      ...(options.args ?? []),
      ...(options.files ?? []),
    ],
  });

  return testing({
    runner: options.reportFile
      ? configuredVitestReport(runner, { cwd, reportFile: options.reportFile })
      : runner,
    report: jestJson(),
    rules: options.rules,
  });
}

export const runner = { command } as const;
export const report = { jestJson, junitXml } as const;

export {
  command,
  jestJson,
  junitXml,
  parseJestJson,
  parseJunitXml,
  testCounts,
  testRunBreaches,
};

export type {
  CommandArgs,
  CommandRunnerOptions,
} from './runner.ts';
export type { CommandPlan } from './model.ts';
export type {
  TestCase,
  TestFailure,
  TestReportCapabilities,
  TestReportFormat,
  TestRuleCatalog,
  TestRuleOptions,
  TestRun,
  TestRunner,
  TestRunnerCompleted,
  TestRunnerContext,
  TestRunnerResult,
  TestRunnerUnavailable,
  TestStatus,
} from './model.ts';
