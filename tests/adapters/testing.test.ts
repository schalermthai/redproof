import assert from 'node:assert/strict';
import { mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { testing, report, runner, parseJestJson, parseJunitXml, testRunBreaches, type TestRunner } from '@redproof/testing';
import { defineRule } from 'redproof';
import { configuredVitestReport } from '../../packages/testing/src/shell/vitest-runner.ts';
import { withWorkspace } from '../helpers/workspace.ts';

const jestSample = JSON.stringify({
  success: false,
  testResults: [
    {
      name: '/workspace/test/parser.test.ts',
      assertionResults: [
        {
          ancestorTitles: ['', 'Parser'],
          title: 'accepts valid input',
          fullName: 'Parser accepts valid input',
          status: 'passed',
          duration: 2,
          failureMessages: [],
          location: { line: 10, column: 3 },
        },
        {
          ancestorTitles: ['', 'Parser'],
          title: 'rejects malformed input',
          fullName: 'Parser rejects malformed input',
          status: 'failed',
          duration: 1,
          failureMessages: ['expected valid to be invalid'],
          location: { line: 20, column: 5 },
        },
        {
          ancestorTitles: ['Parser'],
          title: 'future behavior',
          status: 'todo',
          failureMessages: [],
        },
        {
          ancestorTitles: ['Parser'],
          title: 'platform-specific behavior',
          status: 'pending',
          failureMessages: [],
        },
      ],
    },
  ],
});

const flakyJestSample = JSON.stringify({
  success: true,
  testResults: [{
    name: '/workspace/test/retry.test.ts',
    assertionResults: [{
      ancestorTitles: ['retry'],
      title: 'eventually passes',
      status: 'passed',
      failureMessages: ['expected attempt 1 to succeed'],
      location: { line: 8, column: 3 },
    }],
  }],
});

const retriedJestSample = JSON.stringify({
  success: true,
  testResults: [{
    name: '/workspace/test/retry.test.ts',
    assertionResults: [
      {
        ancestorTitles: ['retry'],
        title: 'eventually passes',
        status: 'passed',
        failureMessages: [],
        retryReasons: [],
        invocations: 2,
        location: { line: 8, column: 3 },
      },
      {
        ancestorTitles: ['retry'],
        title: 'passes first time',
        status: 'passed',
        failureMessages: [],
        retryReasons: [],
        invocations: 1,
        location: { line: 14, column: 3 },
      },
    ],
  }],
});

const junitSample = `<?xml version="1.0" encoding="utf-8"?>
<testsuites name="pytest tests">
  <testsuite name="pytest" failures="1" skipped="1" tests="3">
    <testcase classname="test_parser" name="test_ok" time="0.001" />
    <testcase classname="test_parser" name="test_bad" time="0.002">
      <failure message="assert 1 == 2">test_parser.py:8: AssertionError</failure>
    </testcase>
    <testcase classname="test_parser" name="test_skip" time="0.000">
      <skipped type="pytest.skip" message="later">later</skipped>
    </testcase>
  </testsuite>
</testsuites>`;

test('Jest-compatible JSON normalizes pass/fail/todo/skipped and locations', () => {
  const run = parseJestJson(jestSample);
  assert.deepEqual(run.tests.map(item => item.status), ['passed', 'failed', 'todo', 'skipped']);
  assert.deepEqual(run.tests[1]?.location, {
    file: '/workspace/test/parser.test.ts',
    line: 20,
    column: 5,
  });
  assert.equal(run.tests[1]?.failure?.message, 'expected valid to be invalid');
});

test('JUnit XML normalizes passed, failed and skipped tests', () => {
  const run = parseJunitXml(junitSample);
  assert.deepEqual(run.tests.map(item => item.status), ['passed', 'failed', 'skipped']);
  assert.equal(run.tests[1]?.failure?.message, 'assert 1 == 2');
  assert.deepEqual(run.tests[1]?.suite, ['test_parser']);
});

test('JUnit XML decodes named, decimal, and hexadecimal character references', () => {
  const run = parseJunitXml(`<testsuite name="entities">
    <testcase classname="suite" name="it&#x27;s safe">
      <failure message="&#60;bad&#62; &amp; &#128640;">at &#x3C;anonymous&#x3E;</failure>
    </testcase>
  </testsuite>`);

  assert.equal(run.tests[0]?.name, "it's safe");
  assert.equal(run.tests[0]?.failure?.message, '<bad> & 🚀');
  assert.equal(run.tests[0]?.failure?.detail, 'at <anonymous>');
});

test('JUnit XML leaves out-of-range and surrogate references undecoded', () => {
  const run = parseJunitXml(`<testsuite name="entities">
    <testcase classname="suite" name="over &#x110000; and lone &#xD800;"/>
  </testsuite>`);

  assert.equal(run.tests[0]?.name, 'over &#x110000; and lone &#xD800;');
});

test('JUnit XML does not decode an escaped character reference twice', () => {
  const run = parseJunitXml(`<testsuite name="entities">
    <testcase classname="suite" name="literal &amp;#60;tag&amp;#62;"/>
  </testsuite>`);

  assert.equal(run.tests[0]?.name, 'literal &#60;tag&#62;');
});

test('generic test semantics map statuses to distinct Redproof rules', () => {
  const testsPass = defineRule({ id: 'testing/tests-pass', description: 'tests pass' });
  const noSkippedTests = defineRule({ id: 'testing/no-skipped-tests', description: 'no skip' });
  const noTodoTests = defineRule({ id: 'testing/no-todo-tests', description: 'no todo' });
  const run = parseJestJson(jestSample);

  const breaches = testRunBreaches(run, { testsPass, noSkippedTests, noTodoTests });
  assert.deepEqual(breaches.map(item => item.rule), [
    'testing/tests-pass',
    'testing/no-skipped-tests',
    'testing/no-todo-tests',
  ]);
});

test('Jest-compatible retry evidence maps an ultimately passing test to noFlakyTests', () => {
  const noFlakyTests = defineRule({
    id: 'testing/no-flaky-tests',
    description: 'tests pass on their first attempt',
  });
  const run = parseJestJson(flakyJestSample);

  assert.equal(run.tests[0]?.status, 'passed');
  assert.equal(run.tests[0]?.failure?.message, 'expected attempt 1 to succeed');
  const breaches = testRunBreaches(run, { noFlakyTests });
  assert.equal(breaches.length, 1);
  assert.equal(breaches[0]?.rule, 'testing/no-flaky-tests');
  assert.equal(breaches[0]?.code, 'test-flaky');
  assert.equal(breaches[0]?.detail, 'expected attempt 1 to succeed');
  assert.equal(testRunBreaches(parseJestJson(jestSample), { noFlakyTests }).length, 0);
});

test('Jest retry counts map a passing test with empty failure messages to noFlakyTests', () => {
  const noFlakyTests = defineRule({
    id: 'testing/no-flaky-tests',
    description: 'tests pass on their first attempt',
  });
  const run = parseJestJson(retriedJestSample);

  assert.deepEqual(run.tests.map(item => item.status), ['passed', 'passed']);
  assert.equal(run.tests[0]?.failure?.message, 'passed after 2 invocations');
  assert.equal(run.tests[1]?.failure, undefined);
  const breaches = testRunBreaches(run, { noFlakyTests });
  assert.equal(breaches.length, 1);
  assert.equal(breaches[0]?.code, 'test-flaky');
  assert.equal(breaches[0]?.message, 'retry > eventually passes');
  assert.equal(breaches[0]?.detail, 'passed after 2 invocations');
});

test('JUnit refuses rules for semantics its final-outcome format cannot distinguish', () => {
  const runner: TestRunner = {
    description: 'fake',
    async run() { return { kind: 'completed', exitCode: 0, stdout: '', stderr: '' }; },
  };

  assert.throws(() => testing({
    runner,
    report: report.junitXml(),
    rules: { noTodoTests: true },
  }), /cannot distinguish TODO tests/);
  assert.throws(() => testing({
    runner,
    report: report.junitXml(),
    rules: { noFlakyTests: true },
  }), /cannot distinguish flaky tests/);
});

test('testing adapter trusts structured failures over the command exit code', async () => {
  await withWorkspace(async root => {
    const runner: TestRunner = {
      description: 'write Jest JSON',
      async run(ctx) {
        await writeFile(ctx.reportFile, jestSample, 'utf8');
        return { kind: 'completed', exitCode: 1, stdout: '', stderr: '' };
      },
    };

    const adapter = testing({
      runner,
      report: report.jestJson(),
      rules: { testsPass: true, noSkippedTests: true, noTodoTests: true },
    });

    const result = await adapter.check.run({
      root,
      rules: Object.values(adapter.rules).map(rule => rule.id),
    });

    assert.equal(result.verdict, 'fail');
    if (result.verdict !== 'fail') return;
    assert.deepEqual(result.breaches.map(item => item.rule), [
      'testing/tests-pass',
      'testing/no-skipped-tests',
      'testing/no-todo-tests',
    ]);
  });
});

test('testing adapter normalizes files against the canonical Gate root', async () => {
  await withWorkspace(async root => {
    const alias = join(root, 'alias');
    await symlink(root, alias, 'dir');
    const canonicalRoot = await realpath(root);
    const sample = JSON.stringify({
      testResults: [{
        name: join(canonicalRoot, 'test', 'example.test.ts'),
        assertionResults: [{ title: 'fails', status: 'failed', failureMessages: ['broken'] }],
      }],
    });
    const fake: TestRunner = {
      description: 'write canonical report paths',
      async run(ctx) {
        await writeFile(ctx.reportFile, sample, 'utf8');
        return { kind: 'completed', exitCode: 1, stdout: '', stderr: '' };
      },
    };
    const adapter = testing({
      runner: fake,
      report: report.jestJson(),
      rules: { testsPass: true },
    });

    const result = await adapter.check.run({ root: alias, rules: ['testing/tests-pass'] });
    assert.equal(result.verdict, 'fail');
    if (result.verdict !== 'fail') return;
    assert.equal(result.breaches[0]?.location?.file, 'test/example.test.ts');
  });
});

test('testing adapter refuses when a command completes without a readable report', async () => {
  await withWorkspace(async root => {
    const runner: TestRunner = {
      description: 'broken runner',
      async run() {
        return { kind: 'completed', exitCode: 2, stdout: '', stderr: 'configuration failed' };
      },
    };

    const adapter = testing({
      runner,
      report: report.jestJson(),
      rules: { testsPass: true },
    });

    const result = await adapter.check.run({ root, rules: ['testing/tests-pass'] });
    assert.equal(result.verdict, 'refuse');
    if (result.verdict !== 'refuse') return;
    assert.equal(result.why.code, 'test-report-unavailable');
    assert.match(result.why.detail ?? '', /configuration failed/);
  });
});


test('testing adapter refuses an unexplained non-zero exit even when an empty report exists', async () => {
  await withWorkspace(async root => {
    const runner: TestRunner = {
      description: 'empty failing runner',
      async run(ctx) {
        await writeFile(ctx.reportFile, JSON.stringify({ testResults: [] }), 'utf8');
        return { kind: 'completed', exitCode: 5, stdout: 'no tests collected', stderr: '' };
      },
    };

    const adapter = testing({
      runner,
      report: report.jestJson(),
      rules: { testsPass: true },
    });

    const result = await adapter.check.run({ root, rules: ['testing/tests-pass'] });
    assert.equal(result.verdict, 'refuse');
    if (result.verdict !== 'refuse') return;
    assert.equal(result.why.code, 'test-runner-unsuccessful');
    assert.match(result.why.detail ?? '', /exit code: 5/);
  });
});

test('the testing adapter rejects a rule name it does not know', () => {
  assert.throws(
    () => testing({
      runner: { kind: 'test', async run() { return { exitCode: 0, reportFile: 'x' }; } } as never,
      report: report.junitXml(),
      rules: { testsPass: true, noPurpleTests: true } as never,
    }),
    /Unknown testing rule option: "noPurpleTests"\. Known options: testsPass, noFlakyTests, noSkippedTests, noTodoTests\./,
  );
});

test('a command runner states the command line it will run', () => {
  const built = runner.command({ command: '/usr/local/bin/npm', args: ['run', 'test'] });

  assert.deepEqual(built.plan, { command: '/usr/local/bin/npm', args: ['run', 'test'] });
  assert.equal(built.description, 'run npm run test');
  assert.doesNotMatch(built.description, /\//, 'a description must not carry a machine path');
});

test('a computed argument list is reported per run, not in the plan', () => {
  const built = runner.command({
    command: 'node',
    args: ctx => ['--test', `--out=${ctx.reportFile}`],
  });

  assert.deepEqual(built.plan, { command: 'node' });
  assert.equal(built.description, 'run node');
  assert.deepEqual(
    built.argsFor?.({ root: '/tmp', reportFile: '/tmp/report.xml' }),
    ['--test', '--out=/tmp/report.xml'],
  );
});

test('an explicit runner description still wins over the command line', () => {
  const built = runner.command({
    command: 'npm',
    args: ['test'],
    description: 'run the acceptance suite',
  });

  assert.equal(built.description, 'run the acceptance suite');
  assert.deepEqual(built.plan, { command: 'npm', args: ['test'] });
});

test('a command runner executes from a confined working directory', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'project'));
    const built = runner.command({
      command: process.execPath,
      args: ['-e', 'process.stdout.write(process.cwd())'],
      cwd: 'project',
    });

    const result = await built.run({ root, reportFile: join(root, 'report.json') });
    assert.equal(result.kind, 'completed');
    if (result.kind !== 'completed') return;
    assert.equal(result.stdout, await realpath(join(root, 'project')));
  });
});

test('a command runner refuses lexical and symbolic-link cwd escapes', async () => {
  await withWorkspace(async root => {
    const lexical = runner.command({ command: process.execPath, cwd: '..' });
    const lexicalResult = await lexical.run({ root, reportFile: join(root, 'report.json') });
    assert.equal(lexicalResult.kind, 'unavailable');
    if (lexicalResult.kind === 'unavailable') {
      assert.match(lexicalResult.message, /outside the Gate root/);
    }

    await symlink(tmpdir(), join(root, 'escape'));
    const symbolic = runner.command({ command: process.execPath, cwd: 'escape' });
    const symbolicResult = await symbolic.run({ root, reportFile: join(root, 'report.json') });
    assert.equal(symbolicResult.kind, 'unavailable');
    if (symbolicResult.kind === 'unavailable') {
      assert.match(symbolicResult.message, /outside the Gate root/);
    }
  });
});

test('a configured Vitest report is fresh for the run and the previous file is restored', async () => {
  await withWorkspace(async root => {
    const project = join(root, 'project');
    const configuredReport = join(project, 'results.json');
    const capturedReport = join(root, 'captured.json');
    await mkdir(project);
    await writeFile(configuredReport, 'stale report', 'utf8');

    const fake: TestRunner = {
      description: 'fake Vitest',
      async run() {
        await writeFile(configuredReport, jestSample, 'utf8');
        return { kind: 'completed', exitCode: 0, stdout: '', stderr: '' };
      },
    };
    const wrapped = configuredVitestReport(fake, { cwd: 'project', reportFile: 'results.json' });
    const result = await wrapped.run({ root, reportFile: capturedReport });

    assert.equal(result.kind, 'completed');
    assert.equal(await readFile(capturedReport, 'utf8'), jestSample);
    assert.equal(await readFile(configuredReport, 'utf8'), 'stale report');
  });
});

test('a configured Vitest report refuses a stale file when the run writes nothing', async () => {
  await withWorkspace(async root => {
    const project = join(root, 'project');
    const configuredReport = join(project, 'results.json');
    const capturedReport = join(root, 'captured.json');
    await mkdir(project);
    await writeFile(configuredReport, 'stale report', 'utf8');

    const fake: TestRunner = {
      description: 'fake Vitest that writes nothing',
      async run() {
        return { kind: 'completed', exitCode: 0, stdout: '', stderr: '' };
      },
    };
    const wrapped = configuredVitestReport(fake, { cwd: 'project', reportFile: 'results.json' });
    const result = await wrapped.run({ root, reportFile: capturedReport });

    assert.equal(result.kind, 'unavailable');
    if (result.kind === 'unavailable') {
      assert.match(result.message, /did not produce its configured JSON report/);
    }
    assert.equal(await readFile(capturedReport, 'utf8').catch(() => null), null);
    assert.equal(await readFile(configuredReport, 'utf8'), 'stale report');
  });
});

test('a configured Vitest report refuses paths outside the Gate root', async () => {
  await withWorkspace(async root => {
    let ran = false;
    const fake: TestRunner = {
      description: 'fake Vitest',
      async run() {
        ran = true;
        return { kind: 'completed', exitCode: 0, stdout: '', stderr: '' };
      },
    };
    const wrapped = configuredVitestReport(fake, { cwd: '.', reportFile: '../results.json' });
    const result = await wrapped.run({ root, reportFile: join(root, 'captured.json') });

    assert.equal(result.kind, 'unavailable');
    assert.equal(ran, false);

    await symlink(tmpdir(), join(root, 'escape'));
    const symbolic = configuredVitestReport(fake, { cwd: 'escape', reportFile: 'results.json' });
    const symbolicResult = await symbolic.run({ root, reportFile: join(root, 'captured.json') });
    assert.equal(symbolicResult.kind, 'unavailable');
    assert.equal(ran, false);
  });
});
