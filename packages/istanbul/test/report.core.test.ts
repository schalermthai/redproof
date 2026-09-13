import assert from 'node:assert/strict';
import test from 'node:test';
import { nycArgs, reportIdentity, supportedNycVersion } from '../src/core/report.ts';

const stat = { file: true, symlink: false, nlink: 1, size: 10, ino: 7, dev: 3 };

test('nycArgs places every flag before the separator and the command after it', () => {
  const args = nycArgs({ script: '/n/nyc.js', cwd: '/w', config: '/w/.nycrc', include: ['src/**'], exclude: ['src/vendor/**'],
    reportDirectory: '/t', tempDirectory: '/t/raw', all: false, command: 'node', args: ['test.js', '--bail'] });
  assert.deepEqual(args, ['/n/nyc.js', '--cwd=/w', '--nycrc-path=/w/.nycrc', '--include=src/**', '--exclude=src/vendor/**',
    '--reporter=json', '--report-dir=/t', '--temp-dir=/t/raw', '--clean=true', '--cache=false', '--check-coverage=false', '--all=false',
    '--', 'node', 'test.js', '--bail']);
  const bare = nycArgs({ script: '/n/nyc.js', cwd: '/w', config: undefined, include: [], exclude: [],
    reportDirectory: '/t', tempDirectory: '/t/raw', all: true, command: 'node', args: [] });
  assert.ok(!bare.some(arg => arg.startsWith('--nycrc-path=') || arg.startsWith('--include=') || arg.startsWith('--exclude=')));
  assert.ok(bare.includes('--all=true'));
  assert.deepEqual(bare.slice(-2), ['--', 'node']);
});

test('supportedNycVersion accepts 15 to 18 and refuses everything else', () => {
  for (const version of ['15.0.0', '16.3.1', '17.1.0', '18.99.99']) assert.equal(supportedNycVersion(JSON.stringify({ version })), null);
  for (const version of ['14.9.9', '19.0.0', '1.0.0', '17.1', '17.1.0-beta.1', '150.0.0']) {
    const refusal = supportedNycVersion(JSON.stringify({ version }));
    assert.equal(refusal?.code, 'istanbul-evidence-unavailable', version);
    assert.equal(refusal?.detail, `Unsupported nyc version ${version}; expected >=15 <19.`);
  }
});

test('reportIdentity refuses anything but a private bounded regular file, then any identity change', () => {
  const untrusted = 'Coverage report must be a private bounded regular file.';
  assert.equal(reportIdentity(stat, undefined, 10), null);
  for (const bad of [{ file: false }, { symlink: true }, { nlink: 2 }, { size: 11 }]) {
    assert.equal(reportIdentity({ ...stat, ...bad }, undefined, 10)?.detail, untrusted, JSON.stringify(bad));
  }
  assert.equal(reportIdentity(stat, stat, 10), null);
  for (const bad of [{ file: false }, { ino: 8 }, { dev: 4 }, { nlink: 2 }]) {
    assert.equal(reportIdentity(stat, { ...stat, ...bad }, 10)?.detail, 'Coverage report identity changed.', JSON.stringify(bad));
  }
  assert.equal(reportIdentity({ ...stat, size: 11 }, { ...stat, ino: 8 }, 10)?.detail, untrusted);
});
