import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import test from 'node:test';
import { report, testing, type TestRunner } from '../../packages/testing/src/index.ts';
import { withWorkspace } from '../helpers/workspace.ts';

test('structured: an unexplained nonzero exit REFUSES instead of creating a Breach', async () => {
  await withWorkspace(async root => {
    const runner: TestRunner = {
      description: 'unexplained nonzero contract probe',
      async run(ctx) {
        await writeFile(ctx.reportFile, JSON.stringify({ testResults: [] }), 'utf8');
        return { kind: 'completed', exitCode: 9, stdout: '', stderr: 'tool failed' };
      },
    };
    const adapter = testing({
      runner,
      report: report.jestJson(),
      rules: { testsPass: true },
    });

    const result = await adapter.check.run({ root, rules: [adapter.rules.testsPass.id] });
    assert.equal(result.verdict, 'refuse');
    if (result.verdict === 'refuse') assert.equal(result.why.code, 'test-runner-unsuccessful');
  });
});
