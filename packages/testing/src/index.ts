import {
  defineAdapter,
  defineRules,
  type Adapter,
  type NoUnknownKeys,
  type Rule,
  type RuleRefOfCatalog,
} from 'redproof';
import {
  selectTestRules,
  testRuleCatalog,
  validateTestingOptions,
  type TestingAdapterOptions,
} from './core/check.ts';
import {
  testCounts,
  testRunBreaches,
  type TestRuleCatalog,
  type TestRuleOptions,
} from './core/model.ts';
import { jestJson, parseJestJson } from './core/reports/jest-json.ts';
import { junitXml, parseJunitXml } from './core/reports/junit-xml.ts';
import { validateVitestOptions, vitestArgs, type VitestAdapterOptions } from './core/vitest-options.ts';
import { testingCheck } from './shell/check.ts';
import { command } from './shell/command-runner.ts';
import { configuredVitestReport } from './shell/vitest-runner.ts';
import type { TestReportFormat, TestRunner } from './core/model.ts';

export function testing<const O extends TestingAdapterOptions<TestRuleOptions>>(
  options: O
    & NoUnknownKeys<O, TestingAdapterOptions<TestRuleOptions>>
    & { readonly rules: NoUnknownKeys<O['rules'], TestRuleOptions> },
): Adapter<TestRuleCatalog<O['rules']>> {
  validateTestingOptions(options);

  const rules = defineRules(testRuleCatalog(options.rules) as TestRuleCatalog<O['rules']>);
  type Ref = RuleRefOfCatalog<TestRuleCatalog<O['rules']>>;
  const byAlias = rules as unknown as Readonly<Record<string, Rule<Ref>>>;

  return defineAdapter({
    kind: 'testing',
    rules,
    check: testingCheck(options.runner, options.report, selectTestRules(options.rules, byAlias)),
  });
}

export function defineTestRunner<const R extends TestRunner>(runner: R): R {
  return runner;
}

export function defineTestReport<const R extends TestReportFormat>(report: R): R {
  return report;
}

export function vitest<const O extends VitestAdapterOptions<TestRuleOptions>>(
  options: O
    & NoUnknownKeys<O, VitestAdapterOptions<TestRuleOptions>>
    & { readonly rules: NoUnknownKeys<O['rules'], TestRuleOptions> },
): Adapter<TestRuleCatalog<O['rules']>> {
  validateVitestOptions(options);
  const cwd = options.cwd ?? '.';
  const runner = command({
    command: options.command ?? 'vitest',
    cwd,
    description: 'run Vitest',
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.maxOutputBytes === undefined ? {} : { maxOutputBytes: options.maxOutputBytes }),
    args: ({ reportFile }) => vitestArgs(options, reportFile),
  });

  return testing({
    runner: options.reportFile !== undefined
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

export type { TestingAdapterOptions } from './core/check.ts';
export type { VitestAdapterOptions } from './core/vitest-options.ts';
export type {
  CommandArgs,
  CommandRunnerOptions,
} from './core/command-plan.ts';
export type { CommandPlan } from './core/model.ts';
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
} from './core/model.ts';
