import { runAdapterTck, type AdapterTckSpec, type EvidenceObservation } from '@redproof/adapter-tck';
import { defineRule } from 'redproof';
import {
  report,
  runner,
  testing,
  testRunBreaches,
  vitest,
  type TestRun,
  type TestRunner,
} from '../src/index.ts';
import {
  failingReport,
  installFakeVitest,
  passingReport,
  withWorkspace,
  writesPrivateReport,
} from './support/workspace.ts';

const completedRunner: TestRunner = {
  description: 'TCK completed runner',
  async run() {
    return { kind: 'completed', exitCode: 0, stdout: '', stderr: '' };
  },
};

const rule = defineRule({ id: 'testing/tests-pass', description: 'Tests must pass.' });

function evidence(status: 'passed' | 'failed' | 'skipped' | null): EvidenceObservation {
  const run: TestRun = {
    tests: status === null ? [] : [{
      name: 'example',
      suite: [],
      file: 'test/example.test.ts',
      status,
      location: { file: 'test/example.test.ts', line: 1, column: 1 },
    }],
  };
  return { kind: 'translated', breaches: testRunBreaches(run, { testsPass: rule }) };
}

const testingSpec = {
  name: 'testing',
  kind: 'testing',
  construction: {
    valid: () => testing({
      runner: completedRunner,
      report: report.jestJson(),
      rules: { testsPass: true },
    }),
    emptyRules: {
      name: 'rejects an empty Rule selection',
      run: () => testing({ runner: completedRunner, report: report.jestJson(), rules: {} }),
      message: /requires at least one Redproof rule/u,
    },
    unknownOption: {
      name: 'rejects an unknown top-level option',
      run: () => testing({
        runner: completedRunner,
        report: report.jestJson(),
        rules: { testsPass: true },
        mystery: true,
      } as never),
      message: /Unknown testing adapter option: "mystery"/u,
    },
    invalidValues: [{
      name: 'rejects an unknown Rule option',
      run: () => testing({
        runner: completedRunner,
        report: report.jestJson(),
        rules: { testsPass: true, noPurpleTests: true },
      } as never),
      message: /Unknown testing rule option: "noPurpleTests"/u,
    }, {
      name: 'rejects an invalid command runner',
      run: () => runner.command({ command: '' }),
      message: /command must not be empty/u,
    }],
  },
  unavailable: [{
    name: 'REFUSES when a custom runner throws',
    code: 'test-runner-unavailable',
    run: () => withWorkspace(async root => testing({
      runner: {
        description: 'TCK throwing runner',
        async run() {
          throw new Error('runner exploded');
        },
      },
      report: report.jestJson(),
      rules: { testsPass: true },
    }).check.run({ root, rules: ['testing/tests-pass'] })),
  }],
  evidence: [{
    rule: 'testing/tests-pass',
    expectedBreaches: [{ code: 'test-failed', message: 'example' }],
    violating: () => evidence('failed'),
    clean: () => evidence('passed'),
    unselected: () => evidence('skipped'),
  }],
  purity: {
    kind: 'sources',
    files: [
      'packages/testing/src/core/paths.ts',
      'packages/testing/src/model.ts',
      'packages/testing/src/reports/jest-json.ts',
      'packages/testing/src/reports/junit-xml.ts',
    ],
    allowedExternalImports: ['node:path', 'redproof'],
  },
  capabilities: {
    kind: 'declared',
    supported: [{
      name: 'accepts Rules supported by a capable report format',
      construct: () => testing({
        runner: completedRunner,
        report: report.jestJson(),
        rules: { testsPass: true, noFlakyTests: true, noSkippedTests: true, noTodoTests: true },
      }),
      rules: [
        'testing/tests-pass',
        'testing/no-flaky-tests',
        'testing/no-skipped-tests',
        'testing/no-todo-tests',
      ],
    }],
    unsupported: [{
      name: 'rejects a TODO Rule when the report cannot observe TODO tests',
      run: () => testing({
        runner: completedRunner,
        report: report.junitXml(),
        rules: { noTodoTests: true },
      }),
      message: /cannot distinguish TODO tests/u,
    }, {
      name: 'rejects a flaky Rule when the report cannot observe retries',
      run: () => testing({
        runner: completedRunner,
        report: report.junitXml(),
        rules: { noFlakyTests: true },
      }),
      message: /cannot distinguish flaky tests/u,
    }],
  },
} as const satisfies AdapterTckSpec;

async function checked(
  content: string,
  rules: Parameters<typeof vitest>[0]['rules'],
): Promise<EvidenceObservation> {
  return withWorkspace(async root => {
    await installFakeVitest(root, writesPrivateReport(content));
    const adapter = vitest({ command: process.execPath, rules });
    const checked = await adapter.check.run({
      root,
      rules: Object.values(adapter.rules).map(selected => selected.id),
    });
    return { kind: 'checked', result: checked };
  });
}

const vitestSpec = {
  name: 'vitest',
  kind: 'testing',
  construction: {
    valid: () => vitest({ rules: { testsPass: true } }),
    emptyRules: {
      name: 'rejects an empty Rule selection',
      run: () => vitest({ rules: {} }),
      message: /requires at least one Redproof rule/u,
    },
    unknownOption: {
      name: 'rejects an unknown top-level option',
      run: () => vitest({ rules: { testsPass: true }, mystery: true } as never),
      message: /Unknown Vitest adapter option: "mystery"/u,
    },
    invalidValues: [{
      name: 'rejects an absolute report path',
      run: () => vitest({ reportFile: '/outside.json', rules: { testsPass: true } }),
      message: /reportFile must be relative/u,
    }, {
      name: 'rejects an empty command',
      run: () => vitest({ command: '', rules: { testsPass: true } }),
      message: /command must not be empty/u,
    }],
  },
  unavailable: [{
    name: 'REFUSES when the Vitest process cannot start',
    code: 'test-runner-unavailable',
    run: () => withWorkspace(async root => vitest({
      command: 'redproof-tck-no-such-vitest',
      rules: { testsPass: true },
    }).check.run({ root, rules: ['testing/tests-pass'] })),
  }],
  evidence: [{
    rule: 'testing/tests-pass',
    expectedBreaches: [{ code: 'test-failed' }],
    violating: () => checked(failingReport, { testsPass: true }),
    clean: () => checked(passingReport, { testsPass: true }),
    unselected: () => checked(failingReport, { noSkippedTests: true }),
  }],
  purity: { kind: 'delegated', to: 'testing' },
  capabilities: {
    kind: 'declared',
    supported: [{
      name: 'accepts every Rule supported by its fixed Jest-compatible report',
      construct: () => vitest({
        rules: { testsPass: true, noFlakyTests: true, noSkippedTests: true, noTodoTests: true },
      }),
      rules: [
        'testing/tests-pass',
        'testing/no-flaky-tests',
        'testing/no-skipped-tests',
        'testing/no-todo-tests',
      ],
    }],
    unsupported: [],
  },
} as const satisfies AdapterTckSpec;

runAdapterTck([testingSpec, vitestSpec]);
