import assert from 'node:assert/strict';
import test from 'node:test';
import { breach, counting, defineAdapter, defineGate, fail, pass, type CheckResult, type Scan } from 'redproof';
import type { CheckProjectRun } from '../packages/redproof/src/run/core/run.ts';
import { renderRun } from '../packages/redproof/src/reporter/core/terminal.ts';

const scan: Scan = { source: 'unit', startedAt: '', finishedAt: '', inspected: 1 };
const R1 = { id: 'unit/r1', description: 'R1' } as const;

function runWith(result: CheckResult): CheckProjectRun {
  const gate = defineGate({
    id: 'unit',
    adapter: defineAdapter({
      kind: 'unit',
      rules: { r1: R1 },
      check: { description: 'unit', counting: counting.supported, async run() { return pass(scan); } },
    }),
  });
  const module = { file: '/p/gates/unit.ts', gate };
  return {
    project: { root: '/p', refusalExit: 2, execution: { mode: 'in-place' }, modules: [module] },
    results: [{ module, result, durationMs: 3, workerPid: 1 }],
    exitCode: result.verdict === 'pass' ? 0 : 1,
    startedAt: new Date(0),
    durationMs: 3,
  };
}

const breachAt = (line: number | null, column: number | null) => fail(scan, [
  breach(R1.id, { code: 'r1', message: 'R1 breached', location: { file: 'src/a.ts', line, column } }),
]);

test('a source excerpt clamps its window at the file start and marks the column', () => {
  const output = renderRun(
    runWith(breachAt(1, 3)),
    new Map([['src/a.ts', ['const a = 1;', 'const b = 2;', 'const c = 3;', 'const d = 4;']]]),
    { sourceContext: 2 },
  );

  assert.match(output, / ❯ src\/a\.ts:1:3\n/);
  assert.match(output, / ❯ src\/a\.ts:1:3\n\n     1\| const a = 1;\n      \|   \^\n     2\| const b = 2;\n     3\| const c = 3;\n\n/);
  assert.doesNotMatch(output, /const d = 4/);
});

test('a missing source shows the location without an excerpt', () => {
  const output = renderRun(runWith(breachAt(7, null)), new Map());

  assert.match(output, / ❯ src\/a\.ts:7\n\n   R1 breached/);
  assert.doesNotMatch(output, /\n\s+\d+\| /);
});

test('a diagnostic without a line never asks for source', () => {
  const output = renderRun(runWith(breachAt(null, null)), new Map([['src/a.ts', ['ignored']]]));

  assert.match(output, / ❯ src\/a\.ts\n\n   R1 breached/);
  assert.doesNotMatch(output, /ignored/);
});
