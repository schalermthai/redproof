import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VULTURE_KINDS, excludeMatcher, parseVultureOutput, parseVultureVersion, unreadInput, vultureVersionSupported,
} from '../src/core/model.ts';
import { reports } from './support/reports.ts';

test('a real report parses into one finding per line, with kind, name, line and confidence', () => {
  const { findings, unrecognised } = parseVultureOutput(reports.dirty);
  assert.deepEqual(unrecognised, []);
  assert.equal(findings.length, 17);
  assert.deepEqual(findings[0], { kind: 'unused-import', file: 'a.py', line: 1, name: 'os', message: "unused import 'os'", confidence: 90 });
  assert.deepEqual(findings.slice(2, 4).map(f => `${f.kind}:${f.name}:${f.confidence}`), ['unused-function:unused_func:60', 'unused-variable:unused_arg:100']);
  const kinds = new Set(findings.map(f => f.kind));
  assert.deepEqual([...kinds].sort(), [...VULTURE_KINDS].sort(), 'every kind the adapter offers appears in a real report');
  assert.ok(findings.filter(f => f.kind === 'unreachable-code').every(f => f.name === null && f.confidence === 100));
});

test('reachability messages and the size suffix are recognised; anything else is reported as unrecognised', () => {
  const text = [
    "c.py:6: unreachable code after 'if' (100% confidence)", "c.py:9: unsatisfiable 'ternary' condition (100% confidence)",
    "c.py:15: unreachable 'else' block (100% confidence)", "d.py:2: unused function 'f' (60% confidence, 3 lines)",
    'C:\\p\\e.py:7: unused class \'A: b\' (60% confidence)',
    'a.py:1: something new happened (60% confidence)', 'noise', "a.py:0: unused import 'x' (90% confidence)", "a.py:1: unused import 'x' (101% confidence)",
  ].join('\n');
  const { findings, unrecognised } = parseVultureOutput(text);
  assert.deepEqual(findings.map(f => `${f.file}:${f.line}:${f.kind}`), [
    'c.py:6:unreachable-code', 'c.py:9:unreachable-code', 'c.py:15:unreachable-code', 'd.py:2:unused-function', 'C:\\p\\e.py:7:unused-class',
  ]);
  assert.equal(unrecognised.length, 4);
});

test('stderr: syntax errors and unreadable files are input that was not read; Python warnings are not', () => {
  assert.deepEqual(unreadInput(reports.syntaxError), ['/p/bad.py:1: invalid syntax at "def broken(:"']);
  assert.deepEqual(unreadInput(reports.syntaxWarning), []);
  assert.deepEqual(unreadInput('Error: Could not read file /p/enc.py - \nTry to change the encoding to UTF-8.\n'), ['Error: Could not read file /p/enc.py - ', 'Try to change the encoding to UTF-8.']);
  assert.deepEqual(unreadInput(reports.syntaxWarning + reports.syntaxError), ['/p/bad.py:1: invalid syntax at "def broken(:"']);
  assert.deepEqual(unreadInput('Error: /p/x.py could not be found.\n'), ['Error: /p/x.py could not be found.']);
  assert.deepEqual(unreadInput(''), []);
});

test('the version is read and compared with the oldest release that has --config', () => {
  assert.deepEqual(parseVultureVersion('vulture 2.16\n'), [2, 16]);
  assert.equal(parseVultureVersion('deptry 0.25.1'), null);
  assert.equal(vultureVersionSupported([2, 12]), true);
  assert.equal(vultureVersionSupported([2, 11]), false);
  assert.equal(vultureVersionSupported([3, 0]), true);
  assert.equal(vultureVersionSupported([1, 99]), false);
});

test('--exclude is fnmatch on the absolute path: no wildcard means *pattern*, matching ignores case', () => {
  const excluded = excludeMatcher(['.venv', '*/gen_?.py', 'docs/[!a]*', '']);
  assert.equal(excluded('/r/.venv/lib/x.py'), true);
  assert.equal(excluded('/r/src/GEN_1.py'), true);
  assert.equal(excluded('/r/src/gen_12.py'), false);
  assert.equal(excluded('/r/src/app.py'), false);
  assert.equal(excludeMatcher([''])('/r/anything.py'), false, 'an empty pattern excludes nothing');
});
