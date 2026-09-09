import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeEffects, analyzePureTestEffects, type EffectFinding } from '../../gates/support/effects-model.ts';

const core = 'packages/redproof/src/proof/core/example.ts';
const domain = 'packages/redproof/src/domain/example.ts';
const composition = 'packages/redproof/src/composition/new-io.ts';
const approved = 'packages/redproof/src/inspect/shell/files.ts';

const brief = (item: EffectFinding) => [item.effect, item.line, item.column] as const;

test('effect analysis separates core imports, core ambient inputs, and unapproved boundaries', () => {
  const analysis = analyzeEffects([
    { file: core, content: "import 'node:fs/promises';\nvoid process.cwd();\n" },
    { file: composition, content: "import 'node:child_process';\n" },
    { file: 'packages/redproof/src/command/shell/spawn.ts', content: "import 'node:child_process';\nvoid process.env;\n" },
  ]);

  assert.deepEqual(analysis.coreEffectImports.map(item => [item.file, item.effect]), [[core, 'node:fs/promises']]);
  assert.deepEqual(analysis.coreAmbientInputs.map(item => [item.file, item.effect]), [[core, 'process']]);
  assert.deepEqual(analysis.unapprovedBoundaries.map(item => item.file), [composition]);
});

test('an approved boundary may use effects, and a core file may import non-effect modules', () => {
  const analysis = analyzeEffects([
    { file: approved, content: "import { readFile } from 'node:fs/promises';\nexport const now = new Date();\n" },
    { file: core, content: "import { join } from 'node:path';\nimport { x } from './x.ts';\nexport const y = join('a', 'b');\n" },
  ]);

  assert.deepEqual(analysis, { coreEffectImports: [], coreAmbientInputs: [], unapprovedBoundaries: [] });
});

test('domain modules are part of the core', () => {
  const analysis = analyzeEffects([{ file: domain, content: "import 'node:os';\nexport const seed = Math.random();\n" }]);

  assert.deepEqual(analysis.coreEffectImports.map(item => item.effect), ['node:os']);
  assert.deepEqual(analysis.coreAmbientInputs.map(item => item.effect), ['Math.random']);
  assert.deepEqual(analysis.unapprovedBoundaries, []);
});

test('every import form of an effect module is found, and reported once with its position', () => {
  const content = [
    "import { readFile } from 'node:fs/promises';",
    "export { spawn } from 'child_process';",
    "import os = require('node:os');",
    "const net = await import('node:net');",
    "const http = require('http');",
    "import { setTimeout as sleep } from 'timers/promises';",
    "import { join } from 'node:path';",
  ].join('\n');

  const analysis = analyzeEffects([{ file: core, content }]);

  assert.deepEqual(analysis.coreEffectImports.map(brief), [
    ['node:fs/promises', 1, 1],
    ['child_process', 2, 1],
    ['node:os', 3, 1],
    ['node:net', 4, 19],
    ['http', 5, 14],
    ['timers/promises', 6, 1],
  ]);
  assert.deepEqual(analysis.coreAmbientInputs, []);
});

test('the global process is an ambient input, but a property named process is not', () => {
  const analysis = analyzeEffects([{
    file: core,
    content: [
      "export type Policy = { readonly process: 'child' };",
      'export const options = { process: 1 };',
      'export class Runner { process = 2; process() { return this.process; } }',
      'export const owner = options.process;',
      'export const cwd = process.cwd();',
      'export const alias = process;',
    ].join('\n'),
  }]);

  assert.deepEqual(analysis.coreAmbientInputs.map(brief), [['process', 5, 20], ['process', 6, 22]]);
});

test('the clock is read only by an argument-less new Date, Date.now, or performance', () => {
  const analysis = analyzeEffects([{
    file: core,
    content: [
      'export const epoch = new Date(0);',
      'export const parsed = new Date("2020-01-01");',
      'export const now = new Date();',
      'export const stamp = Date.now();',
      'export const tick = performance.now();',
      'export const copy = new Map();',
    ].join('\n'),
  }]);

  assert.deepEqual(analysis.coreAmbientInputs.map(brief), [['new Date', 3, 20], ['Date.now', 4, 22], ['performance.now', 5, 21]]);
});

test('timers and randomness are ambient inputs', () => {
  const analysis = analyzeEffects([{
    file: core,
    content: [
      'setTimeout(() => {}, 1);',
      'setInterval(() => {}, 1);',
      'setImmediate(() => {});',
      'export const dice = Math.random();',
      'export const flat = Math.floor(1.5);',
      'export const custom = { setTimeout: 1 }.setTimeout;',
    ].join('\n'),
  }]);

  assert.deepEqual(analysis.coreAmbientInputs.map(item => item.effect), ['setTimeout', 'setInterval', 'setImmediate', 'Math.random']);
});

test('pure-test analysis reports every effect in a test regardless of its path', () => {
  const findings = analyzePureTestEffects([
    { file: 'tests/proof.core.test.ts', content: "import './helpers/workspace.ts';\n" },
    { file: 'tests/inspect/text.core.test.ts', content: "import { withWorkspace } from '../helpers/workspace';\n" },
    { file: 'tests/gates/model.core.test.ts', content: "import { mkdtemp } from 'node:fs/promises';\nvoid process.env;\n" },
    { file: 'tests/clean.core.test.ts', content: "import assert from 'node:assert/strict';\nimport { join } from 'node:path';\n" },
  ]);

  assert.deepEqual(findings.map(item => [item.file, item.effect, item.category]), [
    ['tests/proof.core.test.ts', 'temporary workspace helper', 'import'],
    ['tests/inspect/text.core.test.ts', 'temporary workspace helper', 'import'],
    ['tests/gates/model.core.test.ts', 'node:fs/promises', 'import'],
    ['tests/gates/model.core.test.ts', 'process', 'ambient'],
  ]);
});
