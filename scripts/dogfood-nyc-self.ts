import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { istanbul } from '@redproof/istanbul';
import { executeCommand } from 'redproof/command';

// The producer branch runs the actual upstream clean/instrument/test/report workflow.
// npm test cleans .self_coverage before collecting, so old raw coverage cannot leak in.
if (process.argv[2] === '--produce') {
  const root = resolve(process.argv[3]!), reportFile = process.argv[4]!;
  const tests = await executeCommand({ command: 'npm', args: ['test'], cwd: root, timeoutMs: 240_000 });
  if (tests.kind !== 'completed' || tests.exitCode !== 0) throw new Error(JSON.stringify(tests));
  const report = await executeCommand({ command: process.execPath,
    args: ['bin/nyc.js', 'report', '--temp-dir=.self_coverage', '--reporter=json', '--reporter=json-summary', `--report-dir=${dirname(reportFile)}`],
    cwd: root, timeoutMs: 60_000 });
  if (report.kind !== 'completed' || report.exitCode !== 0) throw new Error(JSON.stringify(report));
} else {
  const root = resolve(process.argv[2] ?? '../13-nyc');
  let reportFile = '';
  const adapter = istanbul({ command: process.execPath, timeoutMs: 300_000,
    args: context => { reportFile = context.reportFile; return [fileURLToPath(import.meta.url), '--produce', root, context.reportFile]; },
    expectedFiles: ['index.js', 'bin/nyc.js', 'bin/wrap.js', 'lib/commands/check-coverage.js'],
    rules: { statements: { minimum: 100, perFile: true }, branches: { minimum: 100, perFile: true },
      functions: { minimum: 100, perFile: true }, lines: { minimum: 100, perFile: true } },
  });
  const outcome = await adapter.check.run({ root, rules: Object.values(adapter.rules).map(rule => rule.id) });
  console.log(JSON.stringify({ root, outcome }));
  assert.equal(outcome.verdict, 'pass', JSON.stringify(outcome));
  await assert.rejects(readFile(reportFile), { code: 'ENOENT' });
}
