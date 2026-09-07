import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { checkProject, loadProject, proofEstablished, proveProject } from 'redproof';

const configOf = (name: string) => resolve(`fixtures/${name}/redproof.config.ts`);

function intervalsOverlap(a: { startedAt: string; finishedAt: string }, b: { startedAt: string; finishedAt: string }): boolean {
  const aStart = Date.parse(a.startedAt);
  const aEnd = Date.parse(a.finishedAt);
  const bStart = Date.parse(b.startedAt);
  const bEnd = Date.parse(b.finishedAt);
  return aStart < bEnd && bStart < aEnd;
}

test('in-place mode runs in the coordinator process and UndoMutation restores the original workspace', async () => {
  const config = configOf('execution-in-place');
  const source = resolve('fixtures/execution-in-place/src/state.txt');
  const before = await readFile(source, 'utf8');

  const project = await loadProject(config);
  assert.deepEqual(project.execution, { mode: 'in-place' });

  const check = await checkProject(config);
  assert.equal(check.results.length, 1);
  assert.equal(check.results[0]?.workerPid, process.pid);

  const proof = await proveProject(config);
  assert.equal(proof.exitCode, 0);
  assert.equal(proof.outcomes.length, 2);
  assert.ok(proof.outcomes.every(proofEstablished));
  assert.equal(await readFile(source, 'utf8'), before);
});

test('copies mode runs Gates in separate child processes and respects Gate-level parallelism', async () => {
  const run = await checkProject(configOf('execution-copies-parallel'));

  assert.equal(run.project.execution.mode, 'copies');
  assert.equal(run.results.length, 3);
  assert.ok(run.results.every(item => item.workerPid !== process.pid));
  assert.equal(new Set(run.results.map(item => item.workerPid)).size, 3);

  const scans = run.results.map(item => item.result.scan);
  assert.ok(
    intervalsOverlap(scans[0]!, scans[1]!)
      || intervalsOverlap(scans[0]!, scans[2]!)
      || intervalsOverlap(scans[1]!, scans[2]!),
    'expected at least two Gate checks to overlap',
  );
});

test('copies mode reuses one Gate copy across proofs but returns to the baseline after each undo', async () => {
  const source = resolve('fixtures/execution-copies-proofs/src/state.txt');
  const before = await readFile(source, 'utf8');
  const run = await proveProject(configOf('execution-copies-proofs'));

  assert.equal(run.exitCode, 0);
  assert.deepEqual(
    run.outcomes.map(outcome => [outcome.proof, outcome.status, proofEstablished(outcome)]),
    [
      ['first RED reuses the Gate copy', 'completed', true],
      ['second RED starts from the same clean baseline', 'completed', true],
      ['GREEN sees the baseline after both undos', 'completed', true],
    ],
  );
  assert.equal(new Set(run.outcomes.map(outcome => outcome.workerPid)).size, 1);
  assert.notEqual(run.outcomes[0]?.workerPid, process.pid);
  assert.equal(await readFile(source, 'utf8'), before);
});

test('copies mode rejects a proof when UndoMutation leaves the Gate copy stale', async () => {
  const source = resolve('fixtures/execution-copies-stale/src/state.txt');
  const before = await readFile(source, 'utf8');
  const run = await proveProject(configOf('execution-copies-stale'));

  assert.equal(run.exitCode, 1);
  assert.equal(run.outcomes.length, 1, 'the stale Gate copy must not be reused for later proofs');
  const outcome = run.outcomes[0]!;
  assert.equal(outcome.status, 'unrestored');
  if (outcome.status !== 'unrestored') throw new Error('expected an unrestored proof');
  assert.equal(outcome.error.code, 'workspace-not-restored');
  assert.match(outcome.error.detail ?? '', /modified src\/state\.txt/);
  assert.equal(outcome.result.verdict, 'fail');
  assert.equal(await readFile(source, 'utf8'), before, 'the original workspace must stay untouched');

  await assert.rejects(stat(resolve('fixtures/execution-copies-stale/.redproof')));
});

test('prove rejects a project with Gates but no Proofs', async () => {
  await assert.rejects(
    proveProject(configOf('pass-single')),
    /No Proofs found/,
  );
});

test('Gate files narrow check and prove to the selected Gates', async () => {
  const config = configOf('gate-selection');

  const check = await checkProject(config, ['gates/beta.ts']);
  assert.deepEqual(check.results.map(item => item.module.gate.id), ['beta']);

  const all = await proveProject(config);
  assert.equal(all.outcomes.length, 4);
  const one = await proveProject(config, ['gates/alpha.ts']);
  assert.equal(one.outcomes.length, 2);
  assert.deepEqual([...new Set(one.outcomes.map(outcome => outcome.gate))], ['alpha']);
});

test('a failed Gate exits 1, and a refused Gate exits with refusalExit even beside a failure', async () => {
  const failed = await checkProject(configOf('fail-single'));
  assert.equal(failed.exitCode, 1);

  const mixed = await checkProject(configOf('mixed'));
  assert.deepEqual(new Set(mixed.results.map(item => item.result.verdict)), new Set(['pass', 'fail', 'refuse']));
  assert.equal(mixed.exitCode, mixed.project.refusalExit);
});
