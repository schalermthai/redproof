import assert from 'node:assert/strict';
import test from 'node:test';
import { chmod, mkdir, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { defineGate, runGate } from 'redproof';
import { istanbul, nyc } from '../src/index.ts';
import { sample } from './support/sample.ts';
import { withWorkspace } from './support/workspace.ts';

const rules = { lines: { minimum: 100 } } as const;
const writer = (text: string, extra = '') => `require('node:fs').writeFileSync(process.env.REDPROOF_COVERAGE_REPORT, ${JSON.stringify(text)}); ${extra}`;

for (const outcome of ['pass', 'fail', 'timeout'] as const) {
  test(`cleanup failure preserves ${outcome === 'pass' ? 'a cleanup refusal' : outcome}`, () => withWorkspace(async root => {
    await writeFile(join(root, 'source.js'), 'module.exports = 1;');
    let privateDirectory: string | undefined;
    const adapter = istanbul({ command: process.execPath, rules, timeoutMs: 1000,
      args: ({ reportDirectory }) => {
        privateDirectory = reportDirectory;
        return ['-e', writer(JSON.stringify(sample('source.js', outcome === 'fail' ? [0, 0] : [1, 1])),
          `require('node:fs').chmodSync(${JSON.stringify(reportDirectory)}, 0o500); ${outcome === 'timeout' ? 'setInterval(() => {}, 1000);' : ''}`)];
      },
    });
    try {
      const result = await adapter.check.run({ root, rules: [adapter.rules.lines.id] });
      assert.equal(result.verdict, outcome === 'fail' ? 'fail' : 'refuse');
      if (result.verdict === 'refuse') assert.equal(result.why.code,
        outcome === 'timeout' ? 'command-timeout' : 'istanbul-cleanup-unavailable');
      if (result.verdict === 'fail') assert.equal(result.breaches[0]?.rule, adapter.rules.lines.id);
    } finally {
      if (privateDirectory) {
        await chmod(privateDirectory, 0o700);
        await rm(privateDirectory, { recursive: true, force: true });
      }
    }
  }));
}

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
  // Each case names the reason it expects. Asserting only the verdict hides a
  // deleted guard: the same input still REFUSES, but for an accidental reason
  // such as a JSON parse error further down.
  const untrusted = 'Coverage report must be a private bounded regular file.';
  const bodies: readonly (readonly [string, string | undefined])[] = [
    [writer('x'.repeat(201)), untrusted],
    [`require('node:fs').symlinkSync(${JSON.stringify(join(root, 'old.json'))}, process.env.REDPROOF_COVERAGE_REPORT)`, untrusted],
    [`require('node:fs').linkSync(${JSON.stringify(join(root, 'old.json'))}, process.env.REDPROOF_COVERAGE_REPORT)`, untrusted],
    [writer(JSON.stringify(sample('/outside.js'))), undefined],
  ];
  await writeFile(join(root, 'old.json'), '{}');
  for (const [index, [body, detail]] of bodies.entries()) {
    const adapter = istanbul({ command: process.execPath, args: () => ['-e', body], rules, maxReportBytes: index === 0 ? 200 : 5000 });
    const outcome = await adapter.check.run({ root, rules: [adapter.rules.lines.id] });
    assert.equal(outcome.verdict, 'refuse');
    if (outcome.verdict === 'refuse' && detail) assert.equal(outcome.why.detail, detail);
  }
  const throwing = istanbul({ command: process.execPath, args: () => { throw new Error('broken plan'); }, rules });
  assert.equal((await throwing.check.run({ root, rules: [throwing.rules.lines.id] })).verdict, 'refuse');
  await symlink('/tmp', join(root, 'outside'), 'dir');
  const escaped = istanbul({ command: process.execPath, cwd: 'outside', args: () => ['-e', writer('{}')], rules });
  assert.equal((await escaped.check.run({ root, rules: [escaped.rules.lines.id] })).verdict, 'refuse');
}));

async function fakeNyc(root: string, directory: string, version: string): Promise<void> {
  const home = join(root, directory, 'node_modules', 'nyc');
  await mkdir(join(home, 'bin'), { recursive: true });
  await writeFile(join(home, 'package.json'), JSON.stringify({ name: 'nyc', version }));
  await writeFile(join(home, 'bin', 'nyc.js'), `
    const fs = require('node:fs'), path = require('node:path');
    const argv = process.argv.slice(2), option = name => argv.find(arg => arg.startsWith(name + '=')).slice(name.length + 1);
    fs.writeFileSync(path.join(option('--cwd'), 'argv.json'), JSON.stringify(argv));
    fs.writeFileSync(path.join(option('--report-dir'), 'coverage-final.json'), ${JSON.stringify(JSON.stringify(sample('source.js', [1, 1])))});
  `);
}
test('unsupported nyc version REFUSES before any command runs', () => withWorkspace(async root => {
  await fakeNyc(root, 'sub', '14.1.1');
  await writeFile(join(root, 'source.js'), 'module.exports = 1;');
  const adapter = nyc({ command: process.execPath, cwd: 'sub', rules });
  const outcome = await adapter.check.run({ root, rules: [adapter.rules.lines.id] });
  assert.equal(outcome.verdict, 'refuse');
  if (outcome.verdict === 'refuse') {
    assert.equal(outcome.why.code, 'istanbul-evidence-unavailable');
    assert.match(outcome.why.detail ?? '', /^Unsupported nyc version 14\.1\.1/u);
  }
}));
test('nyc options reach the nyc argv: config file, include, exclude, and all=false', () => withWorkspace(async root => {
  await fakeNyc(root, 'sub', '17.1.0');
  await writeFile(join(root, 'source.js'), 'module.exports = 1;');
  await writeFile(join(root, 'sub', '.nycrc'), '{}');
  const adapter = nyc({ command: process.execPath, args: ['test.js'], cwd: 'sub', configFile: 'sub/.nycrc',
    include: ['src/**'], exclude: ['src/vendor/**'], all: false, rules });
  const outcome = await adapter.check.run({ root, rules: [adapter.rules.lines.id] });
  assert.equal(outcome.verdict, 'pass', JSON.stringify(outcome));
  const argv = JSON.parse(await readFile(join(root, 'sub', 'argv.json'), 'utf8')) as string[];
  const config = argv.find(arg => arg.startsWith('--nycrc-path='));
  assert.ok(config?.endsWith(join('sub', '.nycrc')), config);
  for (const flag of ['--include=src/**', '--exclude=src/vendor/**', '--all=false', '--reporter=json', '--check-coverage=false']) assert.ok(argv.includes(flag), flag);
  assert.deepEqual(argv.slice(argv.indexOf('--')), ['--', process.execPath, 'test.js']);
}));
test('a confined cwd subdirectory is where the producer runs, and the run passes', () => withWorkspace(async root => {
  await mkdir(join(root, 'sub'));
  await writeFile(join(root, 'source.js'), 'module.exports = 1;');
  await writeFile(join(root, 'sub', 'marker.js'), 'module.exports = 1;');
  const adapter = istanbul({ command: process.execPath, cwd: 'sub', rules,
    args: () => ['-e', writer(JSON.stringify(sample('source.js', [1, 1])), "require('./marker.js');")] });
  const outcome = await adapter.check.run({ root, rules: [adapter.rules.lines.id] });
  assert.equal(outcome.verdict, 'pass', JSON.stringify(outcome));
  assert.equal(outcome.scan.inspected, 1);
}));
test('breaches carry the metric message, the count detail, and a per-file location', () => withWorkspace(async root => {
  await writeFile(join(root, 'source.js'), 'module.exports = 1;');
  const overall = istanbul({ command: process.execPath, args: () => ['-e', writer(JSON.stringify(sample('source.js', [0, 0])))], rules });
  const outcome = await overall.check.run({ root, rules: [overall.rules.lines.id] });
  assert.equal(outcome.verdict, 'fail');
  if (outcome.verdict === 'fail') {
    assert.equal(outcome.breaches.length, 1);
    assert.deepEqual({ ...outcome.breaches[0] }, { rule: 'istanbul/lines-coverage', code: 'lines-coverage-below-minimum',
      message: 'lines coverage 0% is below 100% overall.', location: null, detail: '0/2 covered; 2 uncovered.' });
  }
  const perFile = istanbul({ command: process.execPath, args: () => ['-e', writer(JSON.stringify(sample('source.js', [1, 0])))],
    rules: { statements: { minimum: 75, perFile: true } } });
  const filed = await perFile.check.run({ root, rules: [perFile.rules.statements.id] });
  assert.equal(filed.verdict, 'fail');
  if (filed.verdict === 'fail') {
    assert.equal(filed.breaches[0]?.message, 'statements coverage 50% is below 75% for source.js.');
    assert.deepEqual(filed.breaches[0]?.location, { file: 'source.js', line: null, column: null });
    assert.equal(filed.breaches[0]?.detail, '1/2 covered; 1 uncovered.');
  }
}));
test('a plan argument containing NUL REFUSES without running the producer', () => withWorkspace(async root => {
  const adapter = istanbul({ command: process.execPath, args: () => ['-e', 'process.exit(0)\0'], rules });
  const outcome = await adapter.check.run({ root, rules: [adapter.rules.lines.id] });
  assert.equal(outcome.verdict, 'refuse');
  if (outcome.verdict === 'refuse') {
    assert.equal(outcome.why.code, 'istanbul-evidence-unavailable');
    assert.equal(outcome.why.detail, 'Invalid coverage command arguments.');
  }
}));
test('an expected file that is a symlink outside the root REFUSES', () => withWorkspace(async root => {
  await symlink(process.execPath, join(root, 'escaped.js'), 'file');
  const adapter = istanbul({ command: process.execPath, expectedFiles: ['escaped.js'], rules,
    args: () => ['-e', writer(JSON.stringify(sample('escaped.js', [1, 1])))] });
  const outcome = await adapter.check.run({ root, rules: [adapter.rules.lines.id] });
  assert.equal(outcome.verdict, 'refuse');
  if (outcome.verdict === 'refuse') {
    assert.equal(outcome.why.code, 'istanbul-evidence-unavailable');
    assert.equal(outcome.why.detail, 'Istanbul file is outside the Gate root.');
  }
}));
test('a report path that is a directory REFUSES as an untrusted report', () => withWorkspace(async root => {
  const adapter = istanbul({ command: process.execPath, rules,
    args: () => ['-e', "require('node:fs').mkdirSync(process.env.REDPROOF_COVERAGE_REPORT)"] });
  const outcome = await adapter.check.run({ root, rules: [adapter.rules.lines.id] });
  assert.equal(outcome.verdict, 'refuse');
  if (outcome.verdict === 'refuse') {
    assert.equal(outcome.why.code, 'istanbul-evidence-unavailable');
    assert.equal(outcome.why.detail, 'Coverage report must be a private bounded regular file.');
  }
}));
