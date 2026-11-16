import assert from 'node:assert/strict';
import test from 'node:test';
import { jsonArgs, probeArgs, runArgs } from '../src/core/argv.ts';
import { configExclusions, parseProjectConfig } from '../src/core/config.ts';
import { parseCoveragePy } from '../src/core/evidence.ts';
import { resolveConfig } from '../src/core/options.ts';
import { cleanupUnavailable, producerOutcome, reportIdentity } from '../src/core/refusals.ts';
import { confineRequired, confineRoots, trustFiles, type Resolved } from '../src/core/trust.ts';
import { report } from './support/report.ts';

const MAIN = ['-c', runArgs(resolveConfig({ rules: {}, args: ['x'] }), '/d', undefined)[1]!];
test('runArgs/jsonArgs place every flag before the program arguments', () => {
  const config = resolveConfig({ rules: {}, args: ['-m', 'pytest', '-x'], source: ['src', 'lib'], branch: true });
  assert.deepEqual(runArgs(config, '/t/data', '/w/rc'), [...MAIN, 'run', '--data-file=/t/data', '--branch', '--source=src,lib', '--rcfile=/w/rc', '-m', 'pytest', '-x']);
  const bare = runArgs(resolveConfig({ rules: {}, args: ['run.py'], branch: false }), '/t/data', undefined);
  assert.deepEqual(bare, [...MAIN, 'run', '--data-file=/t/data', 'run.py']);
  assert.deepEqual(jsonArgs('/t/data', '/t/r.json', undefined), [...MAIN, 'json', '--data-file=/t/data', '--fail-under=0', '-o', '/t/r.json']);
});
test('producerOutcome refuses any non-zero exit', () => {
  const ok = { kind: 'completed', exitCode: 0, stdout: '', stderr: '' } as never;
  assert.equal(producerOutcome('run', ok), null);
  assert.equal(producerOutcome('run', { kind: 'completed', exitCode: 1, stdout: '', stderr: 'boom' } as never)?.code, 'coverage-py-producer-unsuccessful');
});
test('reportIdentity refuses anything but a bounded regular file', () => {
  assert.equal(reportIdentity({ file: true, symlink: false, size: 10 }, 10), null);
  for (const bad of [{ file: false }, { symlink: true }, { size: 11 }]) assert.ok(reportIdentity({ file: true, symlink: false, size: 10, ...bad }, 10), JSON.stringify(bad));
});
test('cleanupUnavailable keeps its own refusal code in the core', () => {
  assert.equal(cleanupUnavailable('EACCES').code, 'coverage-py-cleanup-unavailable');
});
test('confineRoots: cwd === root is fine; cwd or rcfile outside the root refuses', () => {
  assert.equal(confineRoots('/w', '/w', undefined), null);
  assert.equal(confineRoots('/w', '/w/sub', '/w/sub/.rc'), null);
  assert.match(confineRoots('/w', '/other', undefined)?.detail ?? '', /outside the Gate root/);
  assert.match(confineRoots('/w', '/w', '/etc/rc')?.detail ?? '', /outside the Gate root/);
});
test('trustFiles judges raw shell facts: unresolved, errored, escaping, and fine paths', () => {
  const evidence = parseCoveragePy(report({ 'a.py': { lines: [1, 0] }, 'b.py': { lines: [1, 0] } }), '/w', '/w');
  const resolved = (a: Resolved | undefined, b: Resolved | undefined) => new Map<string, Resolved>([...(a ? [['a.py', a] as const] : []), ...(b ? [['b.py', b] as const] : [])]);
  assert.equal(trustFiles('/w', evidence, resolved({ real: '/w/a.py' }, { real: '/w/b.py' })), null);
  assert.match(trustFiles('/w', evidence, resolved({ real: '/w/a.py' }, undefined))?.detail ?? '', /did not resolve b\.py/);
  assert.match(trustFiles('/w', evidence, resolved({ error: 'ENOENT: gone' }, { real: '/w/b.py' }))?.detail ?? '', /a\.py: ENOENT/);
  assert.match(trustFiles('/w', evidence, resolved({ real: '/w/a.py' }, { real: '/elsewhere/b.py' }))?.detail ?? '', /b\.py: coverage\.py file is outside the Gate root/);
});
test('probeArgs asks coverage.py for config without cwd on sys.path so a local module cannot shadow it', () => {
  const [flag, script] = probeArgs();
  assert.equal(flag, '-c'); assert.match(script ?? '', /sys\.path\.pop\(0\)/); assert.match(script ?? '', /config_file=True/); assert.match(script ?? '', /report:exclude_lines/);
});
test('parseProjectConfig reads the last JSON line and fails closed on anything else', () => {
  assert.deepEqual(parseProjectConfig('warning\n{"files":["a"],"omit":["x"],"exclude":[]}\n'), { files: ['a'], omit: ['x'], exclude: [] });
  for (const bad of ['', 'nope', '{"files":"a","omit":[],"exclude":[]}', '{"files":[],"omit":[1],"exclude":[]}', 'null']) assert.throws(() => parseProjectConfig(bad));
});
test('configExclusions refuses exclusions unless the rcfile is explicit', () => {
  const clean = { files: ['p.toml'], omit: [], exclude: [] }, omits = { files: ['p.toml'], omit: ['a.py'], exclude: [] }, excl = { files: ['p.toml'], omit: [], exclude: ['def g'] };
  assert.equal(configExclusions(clean, false), null);
  assert.equal(configExclusions(omits, true), null);
  assert.equal(configExclusions(omits, false)?.code, 'coverage-py-config-excludes');
  assert.match(configExclusions(excl, false)?.detail ?? '', /exclusion patterns def g/);
});
test('confineRequired returns root-relative paths, or refuses on error, escape, or an unresolved file', () => {
  const ok = new Map<string, Resolved>([['a.py', { real: '/w/a.py' }], ['sub/b.py', { real: '/w/sub/b.py' }]]);
  assert.deepEqual(confineRequired('/w', ['a.py', 'sub/b.py'], ok), { kind: 'confined', paths: ['a.py', 'sub/b.py'] });
  assert.match((confineRequired('/w', ['a.py'], new Map([['a.py', { real: '/elsewhere/a.py' }]])) as { detail: string }).detail, /outside the Gate root/);
  assert.match((confineRequired('/w', ['a.py'], new Map([['a.py', { error: 'ENOENT' }]])) as { detail: string }).detail, /ENOENT/);
  assert.match((confineRequired('/w', ['a.py'], new Map())as { detail: string }).detail, /did not resolve/);
});
