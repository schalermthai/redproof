import { testing, vitest, report, runner } from '@redproof/testing';
import { dependencyCruiser } from '@redproof/dependency-cruiser';
import { stryker } from '@redproof/stryker';
import { command, commands, executeCommand, type CommandExecutionOptions } from 'redproof/command';
import {
  counting,
  defineAdapter,
  defineConfig,
  defineGate,
  defineProofs,
  defineRule,
  defineCheck,
  defineRules,
  proof,
  locate,
  mutate,
  type Breach,
  type Check,
  type CheckResult,
  type CompletedProofOutcome,
  type Diagnostic,
  type ExecutionConfig,
  type Scan,
} from 'redproof';



defineConfig({ execution: { mode: 'in-place' } });
defineConfig({ execution: { mode: 'copies', maxAtOnce: 4 } });

// @ts-expect-error in-place mode does not expose Gate concurrency.
const badExecution: ExecutionConfig = { mode: 'in-place', maxAtOnce: 4 };
void badExecution;

const scan: Scan = {
  source: 'test',
  startedAt: '',
  finishedAt: '',
  inspected: 1,
};

const executionOptions: CommandExecutionOptions = {
  command: 'node',
  cwd: '/project',
  timeoutMs: 1_000,
};
void executeCommand(executionOptions);

const R1 = defineRule({ id: 'r1', description: 'R1' });
const R2 = defineRule({ id: 'r2', description: 'R2' });

const commandCheck: Check<'r1'> = command({
  rule: R1,
  command: 'npm',
  args: ['run', 'lint'],
  exitCodes: { pass: [0], breach: [1] },
});
void commandCheck;

const commandGroup: Check<'r1' | 'r2'> = commands({
  mode: 'parallel',
  maxAtOnce: 2,
  entries: [
    { rule: R1, command: 'npm', args: ['run', 'lint'] },
    { rule: R2, command: 'npm', args: ['test'] },
  ],
});
void commandGroup;

const diagnostic: Diagnostic = {
  code: 'x',
  message: 'x',
  location: null,
};

const breach: Breach<'r1'> = { rule: 'r1', ...diagnostic };
void breach;

// @ts-expect-error PASS cannot contain breaches.
const badPass: CheckResult<'r1'> = { verdict: 'pass', scan, breaches: [{ rule: 'r1', ...diagnostic }] };
void badPass;

// @ts-expect-error FAIL requires a non-empty list.
const badFail: CheckResult<'r1'> = { verdict: 'fail', scan, breaches: [] };
void badFail;

// @ts-expect-error REFUSE diagnostics do not carry Rule identity.
const badRefuse: CheckResult<'r1'> = { verdict: 'refuse', scan, why: { ...diagnostic, rule: 'r1' } };
void badRefuse;

// @ts-expect-error Breach must name one Rule.
const rulelessBreach: Breach<'r1'> = diagnostic;
void rulelessBreach;

const judged = { status: 'completed', gate: 'g', proof: 'p', result: { verdict: 'pass', scan }, workerPid: 1 } as const;

const provedRed: CompletedProofOutcome = { ...judged, expected: 'red', reason: { kind: 'proved', target: 'r1' } };
void provedRed;

// @ts-expect-error A proved RED proof names the Rule it breached.
const targetlessRed: CompletedProofOutcome = { ...judged, expected: 'red', reason: { kind: 'proved' } };
void targetlessRed;

// @ts-expect-error Only a RED proof can find its target already breached.
const greenWithTarget: CompletedProofOutcome = { ...judged, expected: 'green', reason: { kind: 'target-already-breached', target: 'r1', breached: ['r1'] } };
void greenWithTarget;

// @ts-expect-error A verdict mismatch cannot report the verdict it expected.
const sameVerdict: CompletedProofOutcome = { ...judged, expected: 'green', reason: { kind: 'verdict-mismatch', expected: 'pass', actual: 'pass' } };
void sameVerdict;

// @ts-expect-error Diagnostic location is required, even when null.
const missingLocation: Diagnostic = { code: 'x', message: 'x' };
void missingLocation;

const partialComparison: Diagnostic = {
  code: 'x',
  message: 'x',
  location: null,
  // @ts-expect-error Comparison is atomic.
  comparison: { expected: 'a' },
};
void partialComparison;

// @ts-expect-error Severity is deliberately not part of Diagnostic.
const severity: Diagnostic = { code: 'x', message: 'x', location: null, severity: 'error' };
void severity;

// @ts-expect-error Check description is required for inspection/documentation.
const missingDescription: Check<'r1'> = { counting: counting.supported, async run() { return { verdict: 'pass', scan }; } };
void missingDescription;

// @ts-expect-error Counting must be declared explicitly.
const missingCounting: Check<'r1'> = { description: 'check r1', async run() { return { verdict: 'pass', scan }; } };
void missingCounting;

const adapter = defineAdapter({
  kind: 'test',
  rules: { r1: R1 },
  check: {
    description: 'check r1',
    counting: counting.supported,
    async run() {
      return { verdict: 'pass', scan } as const;
    },
  },
});
const gate = defineGate({ id: 'g', adapter });
defineGate({ id: 'optional', adapter, policies: { emptyEvidence: 'allow' } });

// @ts-expect-error empty-evidence policy accepts only refuse or allow.
defineGate({ id: 'bad-policy', adapter, policies: { emptyEvidence: 'yes' } });

// @ts-expect-error unknown Gate policies are rejected.
defineGate({ id: 'unknown-policy', adapter, policies: { emptyInspection: 'allow' } });

// @ts-expect-error the former top-level boolean is not part of the Gate contract.
defineGate({ id: 'legacy-policy', adapter, allowEmptyInspection: true });

defineProofs(gate, [proof.green('green')]);

// @ts-expect-error R2 is not owned by this Gate.
defineProofs(gate, [proof.red(R2, 'wrong rule', { description: 'noop', async apply() { return async () => {}; } })]);


const composedRules = defineRules({
  first: { id: 'composed/first', description: 'first' },
  second: { id: 'composed/second', description: 'second' },
});

const nativeGate = defineGate({
  id: 'native-composed',
  policies: { emptyEvidence: 'refuse' },
  rules: composedRules,
  check: defineCheck(composedRules, {
    description: 'native composed check',
    counting: counting.supported,
    async run() { return { verdict: 'pass', scan } as const; },
  }),
});

defineProofs(nativeGate, [proof.red(composedRules.first, 'first', {
  description: 'noop',
  async apply() { return async () => {}; },
})]);

// @ts-expect-error native Gate proofs must still target a Rule owned by that Gate.
defineProofs(nativeGate, [proof.red(R1, 'foreign rule', {
  description: 'noop',
  async apply() { return async () => {}; },
})]);


const jsonTarget = locate.json({ files: 'package.json', path: '$.scripts.test' });
mutate.jsonSet(jsonTarget, { nested: ['ok', 1, true, null] });

// @ts-expect-error JSON mutation values cannot contain undefined.
mutate.jsonSet(jsonTarget, undefined);

// @ts-expect-error JSON merge values must be JSON values.
mutate.jsonMerge(jsonTarget, { bad: undefined });


const dependencyAdapter = dependencyCruiser({
  rules: {
    domain: 'domain-no-infrastructure',
    application: 'application-no-adapters',
  },
});
proof.red(dependencyAdapter.rules.domain, 'domain dependency proof', {
  description: 'noop',
  async apply() { return async () => {}; },
});

const strykerAdapter = stryker({
  cwd: 'packages/parser',
  rules: {
    mutantsDetected: true,
    mutationScore: { minimum: 80 },
  },
});
proof.red(strykerAdapter.rules.mutantsDetected, 'mutants proof', {
  description: 'noop',
  async apply() { return async () => {}; },
});
proof.red(strykerAdapter.rules.mutationScore, 'score proof', {
  description: 'noop',
  async apply() { return async () => {}; },
});

const scoreOnlyStryker = stryker({ rules: { mutationScore: { minimum: 90 } } });
proof.red(scoreOnlyStryker.rules.mutationScore, 'score only', {
  description: 'noop',
  async apply() { return async () => {}; },
});
// @ts-expect-error mutantsDetected is not exposed when the rule was not selected.
scoreOnlyStryker.rules.mutantsDetected;

const baselineStryker = stryker({
  rules: {
    noNewUndetectedMutants: {
      acceptedMutantsFile: 'accepted-mutants.json',
    },
  },
});
proof.red(baselineStryker.rules.noNewUndetectedMutants, 'mutation baseline proof', {
  description: 'noop',
  async apply() { return async () => {}; },
});
// @ts-expect-error mutationScore is not exposed when the rule was not selected.
baselineStryker.rules.mutationScore;


const vitestAdapter = vitest({
  rules: {
    testsPass: true,
    noFlakyTests: true,
    noSkippedTests: true,
  },
});
proof.red(vitestAdapter.rules.testsPass, 'tests pass proof', {
  description: 'noop',
  async apply() { return async () => {}; },
});
proof.red(vitestAdapter.rules.noSkippedTests, 'no skipped tests proof', {
  description: 'noop',
  async apply() { return async () => {}; },
});
proof.red(vitestAdapter.rules.noFlakyTests, 'no flaky tests proof', {
  description: 'noop',
  async apply() { return async () => {}; },
});

const passOnlyVitest = vitest({ rules: { testsPass: true } });
passOnlyVitest.rules.testsPass;
// @ts-expect-error noSkippedTests is not exposed when the rule was not selected.
passOnlyVitest.rules.noSkippedTests;
// @ts-expect-error noFlakyTests is not exposed when the rule was not selected.
passOnlyVitest.rules.noFlakyTests;

vitest({
  cwd: 'packages/app',
  reportFile: 'test-results.json',
  rules: { testsPass: true },
});
// @ts-expect-error cwd must be a path string.
vitest({ cwd: 1, rules: { testsPass: true } });
// @ts-expect-error reportFile must be a path string.
vitest({ reportFile: 1, rules: { testsPass: true } });
vitest({ timeoutMs: 60_000, maxOutputBytes: 5_000_000, rules: { testsPass: true } });
// @ts-expect-error timeoutMs must be a number.
vitest({ timeoutMs: 'slow', rules: { testsPass: true } });
// @ts-expect-error maxOutputBytes must be a number.
vitest({ maxOutputBytes: 'large', rules: { testsPass: true } });

// An unknown option name must be rejected, not accepted and then ignored.

defineConfig({ root: '.', gatesRoot: 'gates/**/*.ts', refusalExit: 2 });
// @ts-expect-error refuseExit is not a config option.
defineConfig({ root: '.', refuseExit: 2 });
// Known limit: the guard reaches the top level only. A recursive version
// breaks the ExecutionConfig union, so a nested unknown key is still accepted.
defineConfig({ execution: { mode: 'copies', maxAtOne: 4 } });

// @ts-expect-error noPurpleTests is not a testing Rule.
vitest({ rules: { testsPass: true, noPurpleTests: true } });
// @ts-expect-error noPurpleTests is not a testing Rule.
vitest({ rules: { noPurpleTests: true } });

testing({
  runner: runner.command({
    command: 'npm',
    cwd: 'packages/app',
    args: () => ['test'],
    timeoutMs: 60_000,
    maxOutputBytes: 5_000_000,
  }),
  report: report.junitXml(),
  // @ts-expect-error noPurpleTests is not a testing Rule.
  rules: { testsPass: true, noPurpleTests: true },
});

stryker({ rules: { mutantsDetected: true } });
// @ts-expect-error cwd must be a path string.
stryker({ cwd: 1, rules: { mutantsDetected: true } });
// @ts-expect-error acceptedMutantsFile must be a path string.
stryker({ rules: { noNewUndetectedMutants: { acceptedMutantsFile: 1 } } });
// @ts-expect-error mutantsKilled is not a Stryker Rule.
stryker({ rules: { mutantsDetected: true, mutantsKilled: true } });
