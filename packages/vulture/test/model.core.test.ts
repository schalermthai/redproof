import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VULTURE_KINDS, excludeMatcher, testDirectoryAncestor, parseVultureOutput, parseVultureVersion, unreadInput, vultureVersionSupported,
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
    "c.py:15: unreachable 'else' block (100% confidence)", "c.py:16: redundant if-condition (100% confidence)", "c.py:17: unreachable 'else' expression (100% confidence)", "d.py:2: unused function 'f' (60% confidence, 3 lines)",
    'C:\\p\\e.py:7: unused class \'A\' (60% confidence)',
    'a.py:1: something new happened (60% confidence)', 'noise', "a.py:0: unused import 'x' (90% confidence)", "a.py:1: unused import 'x' (101% confidence)",
  ].join('\n');
  const { findings, unrecognised } = parseVultureOutput(text);
  assert.deepEqual(findings.map(f => `${f.file}:${f.line}:${f.kind}`), [
    'c.py:6:unreachable-code', 'c.py:9:unreachable-code', 'c.py:15:unreachable-code', 'c.py:16:unreachable-code', 'c.py:17:unreachable-code', 'd.py:2:unused-function', 'C:\\p\\e.py:7:unused-class',
  ]);
  assert.equal(unrecognised.length, 4);
});

test('stderr: every non-empty line is input that was not read, whatever shape it has', () => {
  assert.deepEqual(unreadInput(reports.syntaxError), ['/p/bad.py:1: invalid syntax at "def broken(:"']);
  assert.deepEqual(unreadInput('Error: Could not read file /p/enc.py - \nTry to change the encoding to UTF-8.\n'), ['Error: Could not read file /p/enc.py - ', 'Try to change the encoding to UTF-8.']);
  assert.deepEqual(unreadInput('Error: /p/x.py could not be found.\n'), ['Error: /p/x.py could not be found.']);
  assert.deepEqual(unreadInput(''), []);
  assert.deepEqual(unreadInput('\n  \n'), []);
  // A warning is no longer waved through by its shape: a syntax-error line can imitate that shape (file name or source text).
  assert.equal(unreadInput(reports.syntaxWarning).length, 2);
  assert.equal(unreadInput('/p/a:1: Warning: .py:1: invalid syntax at "x = = 1"\n').length, 1);
  assert.equal(unreadInput('/p/a.py:1: invalid syntax at "# :1: Warning: x"\n').length, 1);
});

test('a file name that imitates a finding can neither swallow the real finding nor change its kind', () => {
  const hostile = "p2/a:5: unused import 'x' (90% confidence) .py";
  const { findings, unrecognised } = parseVultureOutput(`${hostile}:1: unused function 'f' (60% confidence)\n`);
  assert.deepEqual(unrecognised, []);
  assert.deepEqual(findings.map(f => [f.kind, f.file, f.line, f.name]), [['unused-function', hostile, 1, 'f']]);
  const second = parseVultureOutput(`a:5: b.py:3: unused class 'C' (60% confidence)\n${hostile}:2: unreachable code after 'return' (100% confidence)\n`);
  assert.deepEqual(second.findings.map(f => [f.kind, f.file, f.line]), [['unused-class', 'a:5: b.py', 3], ['unreachable-code', hostile, 2]]);
  // A name vulture cannot emit (space or quote inside the quotes) is not a finding: the line REFUSES instead of being misread.
  for (const line of ["a.py:1: unused import 'x y' (90% confidence)", "a.py:1: unused import 'x' y' (90% confidence)", "a.py:1: unused thing 'x' (90% confidence)", "a.py:1: unreachable code after 'return' extra (100% confidence)"]) {
    assert.deepEqual(parseVultureOutput(line).findings, [], line);
    assert.deepEqual(parseVultureOutput(line).unrecognised, [line]);
  }
});

test('the version is read and compared with the oldest release that has --config', () => {
  assert.deepEqual(parseVultureVersion('vulture 2.16\n'), [2, 16]);
  assert.equal(parseVultureVersion('deptry 0.25.1'), null);
  assert.equal(vultureVersionSupported([2, 12]), true);
  assert.equal(vultureVersionSupported([2, 11]), false);
  assert.equal(vultureVersionSupported([3, 0]), true);
  assert.equal(vultureVersionSupported([1, 99]), false);
});

test('--exclude follows fnmatch exactly: case-sensitive on POSIX, `^` is a literal in a class, no wildcard means *pattern*', () => {
  const excluded = excludeMatcher(['.venv', '*/gen_?.py', 'docs/[!a]*', ''], false);
  assert.equal(excluded('/r/.venv/lib/x.py'), true);
  assert.equal(excluded('/r/src/gen_1.py'), true);
  assert.equal(excluded('/r/src/GEN_1.py'), false);
  assert.equal(excluded('/r/src/gen_12.py'), false);
  assert.equal(excluded('/r/src/app.py'), false);
  assert.equal(excludeMatcher([''], false)('/r/anything.py'), false, 'an empty pattern excludes nothing');
  assert.equal(excludeMatcher(['*/[^a]'], false)('/r/a'), true, '[^a] means "^ or a" in fnmatch');
  assert.equal(excludeMatcher(['*/[^a]'], false)('/r/^'), true);
  assert.equal(excludeMatcher(['*/[^a]'], false)('/r/b'), false);
  assert.equal(excludeMatcher(['mod.py'], false)('/r/Mod.py'), false);
  assert.equal(excludeMatcher(['MOD.PY'], true)('C:/r/mod.py'), true, 'Windows folds case and separators (untested on a real Windows host)');
});

test('a `]` first in a bracket class is a literal, as in fnmatch (and an empty-looking class never throws)', () => {
  const m = (pattern: string, path: string) => excludeMatcher([pattern], false)(path);
  assert.equal(m('*[]a].py', '/p/a.py'), true);
  assert.equal(m('*[]a].py', '/p/].py'), true);
  assert.equal(m('*[]a].py', '/p/b.py'), false);
  assert.equal(m('*[!]b].py', '/p/a.py'), true);
  assert.equal(m('*[!]b].py', '/p/b.py'), false);
  assert.equal(m('*[!]b].py', '/p/].py'), false);
  assert.equal(m('*[]]', '/p/]'), true);
  assert.doesNotThrow(() => excludeMatcher(['[]?*]-.-', '[]', '[!]', '[]-a]'], false));
});

test('vulture treats `test_*` functions and `*Test*` classes as used when ANY ancestor directory is named test or tests', () => {
  assert.equal(testDirectoryAncestor('/home/ci/tests/work/proj', false), 'tests');
  assert.equal(testDirectoryAncestor('/home/ci/test/proj', false), 'test');
  assert.equal(testDirectoryAncestor('/home/me/proj/tests', false), 'tests', 'the root itself counts: every file below it has the segment');
  assert.equal(testDirectoryAncestor('/home/me/proj', false), undefined);
  assert.equal(testDirectoryAncestor('/home/me/contests/proj', false), undefined, 'a name that merely contains it does not count');
  assert.equal(testDirectoryAncestor('/home/me/Tests/proj', false), undefined, 'fnmatch is case-sensitive on POSIX');
  assert.equal(testDirectoryAncestor('C:\\Work\\Tests\\proj', true), 'tests', 'and folded on Windows');
});
