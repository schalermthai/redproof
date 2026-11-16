import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  DEPTRY_CODES, deptryVersionSupported, hasPerRuleIgnores, ignoreIsCleared, parseDeptryReport, parseDeptryVersion,
  parseResolvedConfig, parseScannedFiles, skippedInput,
} from '../src/core/model.ts';
import { fixtures } from './support/workspace.ts';

const real = (name: string): string => readFileSync(`${fixtures}${name}`, 'utf8');

test('a real report parses into findings with their codes, modules and positions', () => {
  const findings = parseDeptryReport(real('example.json'));
  assert.deepEqual(findings.map(f => `${f.code}:${f.module}`), ['DEP002:isort', 'DEP002:requests', 'DEP004:black', 'DEP001:white']);
  assert.deepEqual([findings[2]!.file, findings[2]!.line, findings[2]!.column], ['src/main.py', 4, 8]);
  assert.deepEqual([findings[0]!.line, findings[0]!.column], [null, null], 'a declaration finding has no line');
});

test('a clean report is an empty list; anything else is rejected', () => {
  assert.deepEqual(parseDeptryReport(real('clean.json')), []);
  assert.throws(() => parseDeptryReport('{}'), /array/u);
  assert.throws(() => parseDeptryReport('[{"error":{"code":"DEP001"},"module":"x","location":{"file":"a"}}]'), /message/u);
  assert.throws(() => parseDeptryReport('[{"error":{"code":"DEP001","message":"m"},"module":"x","location":{}}]'), /file/u);
  assert.throws(() => parseDeptryReport('not json'));
});

test('every code the real fixtures use is one of the five this adapter knows', () => {
  const seen = new Set(['example', 'pep_621', 'poetry', 'requirements_txt', 'transitive'].flatMap(n => parseDeptryReport(real(`${n}.json`)).map(f => f.code)));
  assert.deepEqual([...seen].sort(), [...DEPTRY_CODES]);
});

test('the version line is read and compared with the oldest verified release', () => {
  assert.deepEqual(parseDeptryVersion('deptry 0.25.1\n'), [0, 25, 1]);
  assert.equal(parseDeptryVersion('ruff 0.5.0'), null);
  assert.equal(deptryVersionSupported([0, 16, 2]), true);
  assert.equal(deptryVersionSupported([0, 16, 1]), false);
  assert.equal(deptryVersionSupported([0, 12, 0]), false);
  assert.equal(deptryVersionSupported([1, 0, 0]), true);
});

test('the scan line, the skipped-input notices and the configuration echo are read from deptry output', () => {
  assert.equal(parseScannedFiles('x\nScanning 12 files...\n'), 12);
  assert.equal(parseScannedFiles('Scanning 1 file...'), 1);
  assert.equal(parseScannedFiles('Scanning 0 file...'), 0);
  assert.equal(parseScannedFiles('\u001b[1mScanning 3 files...\u001b[0m'), 3);
  assert.equal(parseScannedFiles('no such line'), null);
  assert.deepEqual(skippedInput('Warning: Skipping processing of src/bad.py because of the following error: "SyntaxError".\nok'),
    ['Warning: Skipping processing of src/bad.py because of the following error: "SyntaxError".']);
  assert.deepEqual(skippedInput('Could not parse dependency name from url git+https://x\n'), ['Could not parse dependency name from url git+https://x']);
  assert.deepEqual(skippedInput('Warning: Trying to extract the dependencies from the optional dependency groups'), [], 'other warnings do not hide input');
  const resolved = parseResolvedConfig("per_rule_ignores: {'DEP001': ('zzz',)}\nignore: ('',)\n")!;
  assert.equal(ignoreIsCleared(resolved), true);
  assert.equal(hasPerRuleIgnores(resolved), true);
  assert.equal(hasPerRuleIgnores(parseResolvedConfig('per_rule_ignores: {}\nignore: ()\n')!), false);
  assert.equal(ignoreIsCleared(parseResolvedConfig('per_rule_ignores: {}\nignore: ()\n')!), false);
  assert.equal(parseResolvedConfig('nothing here'), null);
});
