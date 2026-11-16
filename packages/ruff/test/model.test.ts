import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { defineRule } from 'redproof';
import { attribute, parseRuffReport, selectorCovers } from '../src/core/model.ts';
import { fixtures } from './support/workspace.ts';

const read = (name: string) => readFileSync(`${fixtures}${name}`, 'utf8');
const rule = (id: string) => defineRule({ id, description: id });
const plain = (filename: string) => filename.replace('<ROOT>/', '');

test('parses a real captured Ruff report', () => {
  const findings = parseRuffReport(read('f401_0.report.json'));
  assert.equal(findings.length, 15);
  assert.ok(findings.every(finding => finding.code === 'F401'));
  assert.deepEqual(
    { line: findings[0]?.line, column: findings[0]?.column, fix: findings[0]?.fix },
    { line: 2, column: 8, fix: 'safe' },
  );
  assert.deepEqual(parseRuffReport(read('clean.report.json')), []);
});

test('rejects reports that are not a Ruff finding array', () => {
  assert.throws(() => parseRuffReport('{}'), /JSON array/u);
  assert.throws(() => parseRuffReport('not json'));
  assert.throws(() => parseRuffReport('[{"code":"F401","message":"m"}]'), /filename/u);
});

test('selectors match whole linter prefixes, never a longer sibling', () => {
  assert.ok(selectorCovers('S', 'S101'));
  assert.ok(selectorCovers('S1', 'S101'));
  assert.ok(selectorCovers('S101', 'S101'));
  assert.ok(!selectorCovers('S', 'SIM101'), 'S is Bandit, not SIM');
  assert.ok(!selectorCovers('S2', 'S101'));
  assert.ok(selectorCovers('PL', 'PLR0913'), 'PL is the Pylint umbrella');
  assert.ok(!selectorCovers('PLR', 'PLW0602'));
  assert.ok(selectorCovers('F', 'F401'));
  assert.ok(!selectorCovers('F401', 'F'));
});

test('maps findings to the selected Rule with Ruff coordinates and hints', () => {
  const selected = new Map([['F401', rule('ruff/F401')]]);
  const breaches = attribute(parseRuffReport(read('f401_0.report.json')), selected, plain).breaches;
  assert.equal(breaches.length, 15);
  assert.deepEqual(
    { rule: breaches[0]?.rule, code: breaches[0]?.code, file: breaches[0]?.location?.file, line: breaches[0]?.location?.line },
    { rule: 'ruff/F401', code: 'F401', file: 'F401_0.py', line: 2 },
  );
  assert.match(breaches[0]?.message ?? '', /imported but unused/u);
  assert.match(breaches[0]?.hint ?? '', /docs\.astral\.sh/u);
});
