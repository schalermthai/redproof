import assert from 'node:assert/strict';
import test from 'node:test';
import { writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { defineGate, runGate } from 'redproof';
import { istanbul } from '../src/index.ts';
import { sample, withWorkspace } from './support/workspace.ts';

const rules = { lines: { minimum: 100 } } as const;
const writer = (text: string, extra = '') => `require('node:fs').writeFileSync(process.env.REDPROOF_COVERAGE_REPORT, ${JSON.stringify(text)}); ${extra}`;

for (const [name, body, code] of [
  ['missing report', '', 'istanbul-evidence-unavailable'],
  ['malformed report', writer('{'), 'istanbul-evidence-unavailable'],
  ['summary instead of map', writer('{"total":{}}'), 'istanbul-evidence-unavailable'],
  ['failure despite valid coverage', writer(JSON.stringify(sample()), 'process.exit(1)'), 'istanbul-producer-unsuccessful'],
  ['signal', 'process.kill(process.pid, "SIGTERM")', 'command-signaled'],
  ['timeout', 'setInterval(() => {}, 1000)', 'command-timeout'],
  ['output overflow', 'console.log("x".repeat(10000))', 'command-output-limit'],
] as const) test(`REFUSES ${name}`, () => withWorkspace(async root => {
  await writeFile(join(root, 'source.js'), 'module.exports = 1;');
  const adapter = istanbul({ command: process.execPath, args: () => ['-e', body], rules,
    ...(name === 'timeout' ? { timeoutMs: 100 } : {}), ...(name === 'output overflow' ? { maxOutputBytes: 100 } : {}) });
  const result = await adapter.check.run({ root, rules: [adapter.rules.lines.id] });
  assert.equal(result.verdict, 'refuse'); if (result.verdict === 'refuse') assert.equal(result.why.code, code);
}));
test('private reports are isolated concurrently; old report paths are never reused', () => withWorkspace(async root => {
  await writeFile(join(root, 'source.js'), 'module.exports = 1;');
  await writeFile(join(root, 'coverage-final.json'), JSON.stringify(sample('source.js', [1, 1])));
  const paths: string[] = [];
  const adapter = istanbul({ command: process.execPath, rules, args: ({ reportFile }) => {
    paths.push(reportFile); return ['-e', writer(JSON.stringify(sample('source.js', [1, 1])))];
  } });
  const results = await Promise.all([1, 2].map(() => adapter.check.run({ root, rules: [adapter.rules.lines.id] })));
  assert.deepEqual(results.map(result => result.verdict), ['pass', 'pass']); assert.equal(new Set(paths).size, 2);
  const missing = istanbul({ command: process.execPath, args: () => ['-e', ''], rules });
  assert.equal((await missing.check.run({ root, rules: [missing.rules.lines.id] })).verdict, 'refuse');
}));
test('empty reports are subject to Gate emptyEvidence policy', () => withWorkspace(async root => {
  const adapter = istanbul({ command: process.execPath, args: () => ['-e', writer('{}')], rules });
  assert.equal((await runGate(defineGate({ id: 'empty', adapter }), root)).verdict, 'refuse');
  assert.equal((await runGate(defineGate({ id: 'empty', adapter, policies: { emptyEvidence: 'allow' } }), root)).verdict, 'pass');
}));
test('report size, symlinks, outside source paths and throwing plans REFUSE', () => withWorkspace(async root => {
  const bodies = [
    writer('x'.repeat(201)),
    `require('node:fs').symlinkSync(${JSON.stringify(join(root, 'old.json'))}, process.env.REDPROOF_COVERAGE_REPORT)`,
    writer(JSON.stringify(sample('/outside.js'))),
  ];
  await writeFile(join(root, 'old.json'), '{}');
  for (const [index, body] of bodies.entries()) {
    const adapter = istanbul({ command: process.execPath, args: () => ['-e', body], rules, maxReportBytes: index === 0 ? 200 : 5000 });
    assert.equal((await adapter.check.run({ root, rules: [adapter.rules.lines.id] })).verdict, 'refuse');
  }
  const throwing = istanbul({ command: process.execPath, args: () => { throw new Error('broken plan'); }, rules });
  assert.equal((await throwing.check.run({ root, rules: [throwing.rules.lines.id] })).verdict, 'refuse');
  await symlink('/tmp', join(root, 'outside'), 'dir');
  const escaped = istanbul({ command: process.execPath, cwd: 'outside', args: () => ['-e', writer('{}')], rules });
  assert.equal((await escaped.check.run({ root, rules: [escaped.rules.lines.id] })).verdict, 'refuse');
}));
