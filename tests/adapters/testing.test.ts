import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, readdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  defineTestRunner,
  report,
  runner,
  testing,
  vitest,
  type TestRunner,
  type TestRunnerResult,
} from '@redproof/testing';
import { defineGate, runGate, type CheckResult } from 'redproof';
import { withWorkspace } from '../helpers/workspace.ts';
import {
  failingReport,
  installFakeVitest,
  passingReport,
  touches,
  writesPrivateReport,
  writesReport,
} from './fake-vitest.ts';

function fakeRunner(run: TestRunner['run']): TestRunner {
  return defineTestRunner({ description: 'fake test runner', run });
}

/** A runner that writes `content` where the adapter asked, then exits with `exitCode`. */
function writingRunner(content: string, exitCode = 0): TestRunner {
  return fakeRunner(async ctx => {
    await writeFile(ctx.reportFile, content, 'utf8');
    return { kind: 'completed', exitCode, stdout: '', stderr: '' };
  });
}

function refusalOf<R extends string>(result: CheckResult<R>) {
  assert.equal(result.verdict, 'refuse');
  if (result.verdict !== 'refuse') throw new Error('unreachable');
  return result.why;
}

function breachesOf<R extends string>(result: CheckResult<R>) {
  assert.equal(result.verdict, 'fail');
  if (result.verdict !== 'fail') throw new Error('unreachable');
  return result.breaches;
}

const mixedReport = JSON.stringify({
  numTotalTests: 4,
  numFailedTests: 1,
  testResults: [{
    name: '/repo/test/parser.test.ts',
    assertionResults: [
      { title: 'accepts valid input', status: 'passed' },
      { title: 'rejects malformed input', status: 'failed', failureMessages: ['expected valid to be invalid'] },
      { title: 'future behavior', status: 'todo' },
      { title: 'platform-specific behavior', status: 'pending' },
    ],
  }],
});

test('the testing adapter rejects a rule name it does not know', () => {
  assert.throws(
    () => testing({
      runner: fakeRunner(async () => ({ kind: 'completed', exitCode: 0, stdout: '', stderr: '' })),
      report: report.junitXml(),
      rules: { testsPass: true, noPurpleTests: true } as never,
    }),
    /Unknown testing rule option: "noPurpleTests"\. Known options: testsPass, noFlakyTests, noSkippedTests, noTodoTests\./,
  );
});

test('the testing adapter refuses to build a Check that would police nothing', () => {
  assert.throws(
    () => testing({
      runner: fakeRunner(async () => ({ kind: 'completed', exitCode: 0, stdout: '', stderr: '' })),
      report: report.junitXml(),
      rules: {},
    }),
    /Testing adapter requires at least one Redproof rule\./,
  );
});

test('a report format rejects at composition time the Rules its results cannot support', () => {
  const built = fakeRunner(async () => ({ kind: 'completed', exitCode: 0, stdout: '', stderr: '' }));

  assert.throws(
    () => testing({ runner: built, report: report.junitXml(), rules: { noTodoTests: true } }),
    /Report format junit-xml cannot distinguish TODO tests\./,
  );
  assert.throws(
    () => testing({ runner: built, report: report.junitXml(), rules: { noFlakyTests: true } }),
    /Report format junit-xml cannot distinguish flaky tests\./,
  );
  assert.doesNotThrow(
    () => testing({ runner: built, report: report.jestJson(), rules: { noTodoTests: true, noFlakyTests: true } }),
  );
});

test('testing process limits must be positive integers', () => {
  assert.throws(() => runner.command({ command: 'test', timeoutMs: 0 }), /timeoutMs must be a positive integer/);
  assert.throws(() => runner.command({ command: 'test', timeoutMs: 1.5 }), /timeoutMs must be a positive integer/);
  assert.throws(() => vitest({ maxOutputBytes: -1, rules: { testsPass: true } }), /maxOutputBytes must be a positive integer/);
  assert.doesNotThrow(() => runner.command({ command: 'test', timeoutMs: 1, maxOutputBytes: 1 }));
});

test('the Vitest adapter rejects a configured report path that is empty or absolute', () => {
  assert.throws(() => vitest({ reportFile: '', rules: { testsPass: true } }), /reportFile must not be empty/);
  assert.throws(
    () => vitest({ reportFile: join(tmpdir(), 'results.json'), rules: { testsPass: true } }),
    /reportFile must be relative/,
  );
});

test('a Check states the command it runs and the report format it interprets', () => {
  const adapter = testing({
    runner: runner.command({ command: 'pytest', args: ['-q'] }),
    report: report.junitXml(),
    rules: { testsPass: true },
  });

  assert.equal(adapter.check.description, 'run pytest -q; interpret junit-xml test results');
  assert.equal(vitest({ rules: { testsPass: true } }).check.description, 'run Vitest; interpret jest-json test results');
});

test('the adapter reports each failed, skipped and todo test as a breach of its own Rule', async () => {
  await withWorkspace(async root => {
    const adapter = testing({
      runner: writingRunner(mixedReport, 1),
      report: report.jestJson(),
      rules: { testsPass: true, noSkippedTests: true, noTodoTests: true },
    });

    const result = await adapter.check.run({
      root,
      rules: Object.values(adapter.rules).map(rule => rule.id),
    });

    assert.deepEqual(breachesOf(result).map(item => [item.rule, item.message]), [
      ['testing/tests-pass', 'rejects malformed input'],
      ['testing/no-skipped-tests', 'platform-specific behavior'],
      ['testing/no-todo-tests', 'future behavior'],
    ]);
    assert.equal(result.scan.inspected, 4);
    assert.equal(result.scan.source, 'testing/jest-json');
  });
});

test('a structured report of passing tests passes despite an unsuccessful exit code being absent', async () => {
  await withWorkspace(async root => {
    const adapter = testing({
      runner: writingRunner(passingReport, 0),
      report: report.jestJson(),
      rules: { testsPass: true, noSkippedTests: true },
    });

    const result = await adapter.check.run({ root, rules: ['testing/tests-pass', 'testing/no-skipped-tests'] });
    assert.equal(result.verdict, 'pass');
    assert.equal(result.scan.inspected, 1);
  });
});

test('test files are reported relative to the Gate root even when the root is reached through a symbolic link', async () => {
  await withWorkspace(async root => {
    const alias = join(root, 'alias');
    await symlink(root, alias, 'dir');
    const canonicalRoot = await realpath(root);
    const adapter = testing({
      runner: writingRunner(JSON.stringify({
        numTotalTests: 1,
        numFailedTests: 1,
        testResults: [{
          name: join(canonicalRoot, 'test', 'example.test.ts'),
          assertionResults: [{ title: 'fails', status: 'failed', failureMessages: ['broken'] }],
        }],
      }), 1),
      report: report.jestJson(),
      rules: { testsPass: true },
    });

    const result = await adapter.check.run({ root: alias, rules: ['testing/tests-pass'] });
    assert.equal(breachesOf(result)[0]?.location?.file, 'test/example.test.ts');
  });
});

test('a completed command that leaves no readable report refuses with its captured output', async () => {
  await withWorkspace(async root => {
    const adapter = testing({
      runner: fakeRunner(async () => ({
        kind: 'completed',
        exitCode: 2,
        stdout: 'collected 0 items',
        stderr: 'configuration failed',
      })),
      report: report.jestJson(),
      rules: { testsPass: true },
    });

    const why = refusalOf(await adapter.check.run({ root, rules: ['testing/tests-pass'] }));
    assert.equal(why.code, 'test-report-unavailable');
    assert.equal(why.message, 'The test command did not produce a trustworthy structured report.');
    assert.match(why.detail ?? '', /configuration failed/);
    assert.match(why.detail ?? '', /collected 0 items/);
    assert.match(why.detail ?? '', /exit code: 2/);
  });
});

test('a report whose summary contradicts its assertions refuses instead of passing', async () => {
  await withWorkspace(async root => {
    const adapter = testing({
      runner: writingRunner(JSON.stringify({ numTotalTests: 1, numFailedTests: 0, testResults: [] }), 0),
      report: report.jestJson(),
      rules: { testsPass: true },
    });

    const why = refusalOf(await adapter.check.run({ root, rules: ['testing/tests-pass'] }));
    assert.equal(why.code, 'test-report-unavailable');
    assert.match(why.detail ?? '', /numTotalTests is 1, but assertionResults contain 0/);
  });
});

test('an unsuccessful exit that no failed test explains refuses rather than passing on an empty report', async () => {
  await withWorkspace(async root => {
    const adapter = testing({
      runner: fakeRunner(async ctx => {
        await writeFile(ctx.reportFile, JSON.stringify({ testResults: [] }), 'utf8');
        return { kind: 'completed', exitCode: 5, stdout: 'no tests collected', stderr: '' };
      }),
      report: report.jestJson(),
      rules: { testsPass: true },
    });

    const result = await adapter.check.run({ root, rules: ['testing/tests-pass'] });
    const why = refusalOf(result);
    assert.equal(why.code, 'test-runner-unsuccessful');
    assert.match(why.detail ?? '', /no tests collected/);
    assert.match(why.detail ?? '', /exit code: 5/);
    assert.equal(result.scan.inspected, 0);
  });
});

test('a failing exit that the report does explain is a FAIL, not a refusal', async () => {
  await withWorkspace(async root => {
    const adapter = testing({
      runner: writingRunner(failingReport, 1),
      report: report.jestJson(),
      rules: { testsPass: true },
    });

    const result = await adapter.check.run({ root, rules: ['testing/tests-pass'] });
    assert.deepEqual(breachesOf(result).map(item => item.code), ['test-failed']);
  });
});

test('a runner that could not start refuses as unavailable test evidence', async () => {
  await withWorkspace(async root => {
    const adapter = testing({
      runner: fakeRunner(async (): Promise<TestRunnerResult> => ({
        kind: 'unavailable',
        message: 'The in-house test tool could not start.',
        detail: 'ENOENT',
      })),
      report: report.jestJson(),
      rules: { testsPass: true },
    });

    const result = await adapter.check.run({ root, rules: ['testing/tests-pass'] });
    const why = refusalOf(result);
    assert.equal(why.code, 'test-runner-unavailable');
    assert.equal(why.message, 'The in-house test tool could not start.');
    assert.equal(why.detail, 'ENOENT');
    assert.equal(result.scan.inspected, null);
  });
});

test('a valid empty report passes the Check, but the Gate refuses it unless empty evidence is allowed', async () => {
  await withWorkspace(async root => {
    const adapter = testing({
      runner: writingRunner(JSON.stringify({
        numTotalTests: 0,
        numFailedTests: 0,
        testResults: [],
      }), 0),
      report: report.jestJson(),
      rules: { testsPass: true },
    });

    const parsed = await adapter.check.run({ root, rules: ['testing/tests-pass'] });
    assert.equal(parsed.verdict, 'pass', 'an empty but internally consistent report is trustworthy');
    assert.equal(parsed.scan.inspected, 0);

    const guarded = await runGate(defineGate({ id: 'tests', adapter }), root);
    assert.equal(refusalOf(guarded).code, 'nothing-inspected');

    const allowed = await runGate(defineGate({
      id: 'optional-tests',
      adapter,
      policies: { emptyEvidence: 'allow' },
    }), root);
    assert.equal(allowed.verdict, 'pass');
    assert.equal(allowed.scan.inspected, 0);
  });
});

test('a command runner states the command line it will run, without a machine-specific directory', () => {
  const built = runner.command({ command: '/usr/local/bin/npm', args: ['run', 'test'] });

  assert.deepEqual(built.plan, { command: '/usr/local/bin/npm', args: ['run', 'test'] });
  assert.equal(built.description, 'run npm run test');

  const named = runner.command({ command: 'npm', args: ['test'], description: 'run the acceptance suite' });
  assert.equal(named.description, 'run the acceptance suite');
  assert.deepEqual(named.plan, { command: 'npm', args: ['test'] });

  assert.equal(runner.command({ command: 'npm' }).description, 'run npm');
});

test('a computed argument list is answered per run, not promised in the plan', () => {
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
  assert.deepEqual(runner.command({ command: 'node' }).argsFor?.({ root: '/tmp', reportFile: '/tmp/r.xml' }), []);
});

test('a real test command runs inside its confined working directory and is told where to write its report', async () => {
  await withWorkspace(async root => {
    const project = join(root, 'project');
    await mkdir(project);
    const adapter = testing({
      runner: runner.command({
        command: process.execPath,
        cwd: 'project',
        args: [
          '-e',
          `require('node:fs').writeFileSync(process.env.REDPROOF_TEST_REPORT, JSON.stringify({
             numTotalTests: 1,
             numFailedTests: 1,
             testResults: [{ name: 'suite.js', assertionResults: [
               { title: process.cwd(), status: 'failed', failureMessages: ['reported from the child'] },
             ] }],
           }))`,
        ],
      }),
      report: report.jestJson(),
      rules: { testsPass: true },
    });

    const result = await adapter.check.run({ root, rules: ['testing/tests-pass'] });
    const [breach] = breachesOf(result);
    assert.equal(breach?.message, await realpath(project), 'the command runs in the confined working directory');
    assert.equal(breach?.detail, 'reported from the child');
  });
});

test('a command runner refuses lexical and symbolic-link working-directory escapes', async () => {
  await withWorkspace(async root => {
    const marker = join(root, 'started');
    const args = ['-e', touches(marker)];

    const lexical = await runner.command({ command: process.execPath, args, cwd: '..' })
      .run({ root, reportFile: join(root, 'report.json') });
    assert.equal(lexical.kind, 'unavailable');
    if (lexical.kind === 'unavailable') {
      assert.equal(lexical.message, 'The test working directory resolves outside the Gate root.');
    }

    await symlink(tmpdir(), join(root, 'escape'));
    const symbolic = await runner.command({ command: process.execPath, args, cwd: 'escape' })
      .run({ root, reportFile: join(root, 'report.json') });
    assert.equal(symbolic.kind, 'unavailable');
    if (symbolic.kind === 'unavailable') {
      assert.equal(symbolic.message, 'The test working directory resolves outside the Gate root.');
    }

    assert.equal(await lstat(marker).then(() => true, () => false), false, 'neither escape may run the command');
  });
});

test('a command runner refuses output beyond its capture limit and keeps the captured prefix', async () => {
  await withWorkspace(async root => {
    const built = runner.command({
      command: process.execPath,
      args: ['-e', "process.stdout.write('1234567890')"],
      maxOutputBytes: 5,
    });

    const result = await built.run({ root, reportFile: join(root, 'report.json') });
    assert.equal(result.kind, 'unavailable');
    if (result.kind !== 'unavailable') return;
    assert.match(result.message, /exceeded the 5-byte output limit/);
    assert.match(result.detail ?? '', /command-output-limit/);
    assert.match(result.detail ?? '', /stdout:\n12345/);
  });
});

test('a command runner refuses when the command outlives its timeout', async () => {
  await withWorkspace(async root => {
    const built = runner.command({
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1_000)'],
      timeoutMs: 100,
    });

    const result = await built.run({ root, reportFile: join(root, 'report.json') });
    assert.equal(result.kind, 'unavailable');
    if (result.kind !== 'unavailable') return;
    assert.match(result.message, /exceeded its 100ms timeout/);
    assert.match(result.detail ?? '', /command-timeout/);
  });
});

test('a test command that cannot start refuses as unavailable and names the command', async () => {
  await withWorkspace(async root => {
    const missing = await runner.command({ command: 'redproof-no-such-binary' })
      .run({ root, reportFile: join(root, 'report.json') });
    assert.equal(missing.kind, 'unavailable');
    if (missing.kind === 'unavailable') {
      assert.equal(missing.message, 'Could not start test command redproof-no-such-binary.');
      assert.match(missing.detail ?? '', /command-unavailable/);
    }

    const empty = await runner.command({ command: '' }).run({ root, reportFile: join(root, 'report.json') });
    assert.equal(empty.kind, 'unavailable');
    if (empty.kind === 'unavailable') {
      assert.match(empty.message, /Could not start test command/);
      assert.match(empty.detail ?? '', /command must not be empty/);
    }
  });
});

test('a private report is requested from Vitest when no configured report file is named', async () => {
  await withWorkspace(async root => {
    const project = join(root, 'project');
    await installFakeVitest(project, writesPrivateReport(failingReport));
    const adapter = vitest({
      command: process.execPath,
      cwd: 'project',
      rules: { testsPass: true },
    });

    const result = await adapter.check.run({ root, rules: ['testing/tests-pass'] });
    assert.deepEqual(breachesOf(result).map(item => item.message), ['breaks']);
    assert.deepEqual(await readdir(project), ['run'], 'no report is left inside the project');
  });
});

test('a configured Vitest report is read fresh, and any file that existed before is put back', async () => {
  await withWorkspace(async root => {
    const project = join(root, 'project');
    const configured = join(project, 'results.json');
    await installFakeVitest(project, writesReport('results.json', failingReport));
    await writeFile(configured, 'stale report', 'utf8');

    const adapter = vitest({
      command: process.execPath,
      cwd: 'project',
      reportFile: 'results.json',
      rules: { testsPass: true },
    });

    const result = await adapter.check.run({ root, rules: ['testing/tests-pass'] });
    assert.deepEqual(breachesOf(result).map(item => item.message), ['breaks'], 'the fresh report decides the verdict');
    assert.equal(await readFile(configured, 'utf8'), 'stale report', 'the previous report is put back');
    assert.deepEqual((await readdir(project)).sort(), ['results.json', 'run']);
  });
});

test('a report directory created during the run is removed again when it is left empty', async () => {
  await withWorkspace(async root => {
    const project = join(root, 'project');
    await installFakeVitest(project, writesReport('reports/nested/results.json', passingReport));

    const adapter = vitest({
      command: process.execPath,
      cwd: 'project',
      reportFile: 'reports/nested/results.json',
      rules: { testsPass: true },
    });

    assert.equal((await adapter.check.run({ root, rules: ['testing/tests-pass'] })).verdict, 'pass');
    assert.deepEqual(await readdir(project), ['run'], 'the run leaves no report directory behind');
  });
});

test('cleanup removes only the empty directories the run itself created', async () => {
  await withWorkspace(async root => {
    const project = join(root, 'project');
    const reports = join(project, 'reports');
    await installFakeVitest(project, writesReport('reports/nested/results.json', passingReport));
    await mkdir(reports);

    const adapter = vitest({
      command: process.execPath,
      cwd: 'project',
      reportFile: 'reports/nested/results.json',
      rules: { testsPass: true },
    });

    assert.equal((await adapter.check.run({ root, rules: ['testing/tests-pass'] })).verdict, 'pass');
    assert.equal((await lstat(reports)).isDirectory(), true, 'a directory that existed before the run is kept');
    assert.deepEqual(await readdir(reports), [], 'the directory the run created is removed');
  });
});

test('cleanup keeps a directory it created once the run puts other files in it', async () => {
  await withWorkspace(async root => {
    const project = join(root, 'project');
    const reports = join(project, 'reports');
    await installFakeVitest(
      project,
      writesReport(
        'reports/nested/results.json',
        passingReport,
        "fs.writeFileSync(path.resolve('reports/coverage.txt'), 'user data');",
      ),
    );

    const adapter = vitest({
      command: process.execPath,
      cwd: 'project',
      reportFile: 'reports/nested/results.json',
      rules: { testsPass: true },
    });

    assert.equal((await adapter.check.run({ root, rules: ['testing/tests-pass'] })).verdict, 'pass');
    assert.deepEqual(await readdir(reports), ['coverage.txt']);
    assert.equal(await readFile(join(reports, 'coverage.txt'), 'utf8'), 'user data');
  });
});

test('cleanup refuses when a directory the run created cannot be removed', async () => {
  await withWorkspace(async root => {
    const project = join(root, 'project');
    const elsewhere = join(project, 'elsewhere');
    await installFakeVitest(project, `
      const fs = require('node:fs');
      const path = require('node:path');
      fs.symlinkSync(path.resolve('elsewhere'), path.resolve('reports/nested'));
      fs.writeFileSync(path.resolve('elsewhere/results.json'), ${JSON.stringify(passingReport)});
    `);
    await mkdir(join(project, 'reports'));
    await mkdir(elsewhere);

    const adapter = vitest({
      command: process.execPath,
      cwd: 'project',
      reportFile: 'reports/nested/results.json',
      rules: { testsPass: true },
    });

    const why = refusalOf(await adapter.check.run({ root, rules: ['testing/tests-pass'] }));
    assert.equal(why.code, 'test-runner-unavailable');
    assert.equal(why.message, 'A generated Vitest report directory could not be removed.');
  });
});

test('a configured report that the run never writes refuses, and a stale previous report is never read', async () => {
  await withWorkspace(async root => {
    const project = join(root, 'project');
    const configured = join(project, 'results.json');
    await installFakeVitest(project, '');
    await writeFile(configured, failingReport, 'utf8');

    const adapter = vitest({
      command: process.execPath,
      cwd: 'project',
      reportFile: 'results.json',
      rules: { testsPass: true },
    });

    const why = refusalOf(await adapter.check.run({ root, rules: ['testing/tests-pass'] }));
    assert.equal(why.message, 'Vitest did not produce its configured JSON report.');
    assert.equal(await readFile(configured, 'utf8'), failingReport, 'the previous report is put back untouched');
  });
});

test('a previous report that cannot be set aside refuses before the tests run', async () => {
  await withWorkspace(async root => {
    const project = join(root, 'project');
    const configured = join(project, 'results.json');
    const marker = join(root, 'started');
    await installFakeVitest(project, touches(marker));
    await writeFile(configured, 'previous report', 'utf8');
    await chmod(project, 0o555);

    const adapter = vitest({
      command: process.execPath,
      cwd: 'project',
      reportFile: 'results.json',
      rules: { testsPass: true },
    });

    try {
      const why = refusalOf(await adapter.check.run({ root, rules: ['testing/tests-pass'] }));
      assert.match(why.message, /The previous Vitest report could not be set aside\./);
      assert.equal(await lstat(marker).then(() => true, () => false), false, 'the tests must not run');
    } finally {
      await chmod(project, 0o755);
    }
    assert.equal(await readFile(configured, 'utf8'), 'previous report');
  });
});

test('a previous report that cannot be put back refuses even though the tests ran', async () => {
  await withWorkspace(async root => {
    const project = join(root, 'project');
    await installFakeVitest(project, `
      const fs = require('node:fs');
      const path = require('node:path');
      for (const name of fs.readdirSync('.')) {
        if (name.includes('.redproof-backup-')) fs.rmSync(path.resolve(name));
      }
      fs.writeFileSync(path.resolve('results.json'), ${JSON.stringify(passingReport)});
    `);
    await writeFile(join(project, 'results.json'), 'previous report', 'utf8');

    const adapter = vitest({
      command: process.execPath,
      cwd: 'project',
      reportFile: 'results.json',
      rules: { testsPass: true },
    });

    const why = refusalOf(await adapter.check.run({ root, rules: ['testing/tests-pass'] }));
    assert.match(why.message, /The previous Vitest report could not be restored from /);
    assert.match(why.message, /results\.json\.redproof-backup-/);
  });
});

test('a configured report outside the Gate root refuses before the tests run', async () => {
  await withWorkspace(async root => {
    const marker = join(root, 'started');
    await installFakeVitest(root, touches(marker));

    const lexical = vitest({
      command: process.execPath,
      reportFile: '../results.json',
      rules: { testsPass: true },
    });
    const lexicalWhy = refusalOf(await lexical.check.run({ root, rules: ['testing/tests-pass'] }));
    assert.equal(lexicalWhy.message, 'The configured Vitest report resolves outside the Gate root.');

    await withWorkspace(async outside => {
      await installFakeVitest(outside, touches(marker));
      await symlink(outside, join(root, 'escape'), 'dir');
      const symbolic = vitest({
        command: process.execPath,
        cwd: 'escape',
        reportFile: 'results.json',
        rules: { testsPass: true },
      });
      const symbolicWhy = refusalOf(await symbolic.check.run({ root, rules: ['testing/tests-pass'] }));
      assert.equal(symbolicWhy.message, 'The configured Vitest report resolves outside the Gate root.');
    });

    assert.equal(await lstat(marker).then(() => true, () => false), false, 'neither escape may run the tests');
  });
});
