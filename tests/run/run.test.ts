import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import {
  checkProject,
  GateSelectionError,
  proofEstablished,
  proveProject,
  type GateRun,
} from 'redproof';
import { withWorkspace } from '../helpers/workspace.ts';
import {
  proofSource,
  stateGateModule,
  throwingGateModule,
  verdictGateModule,
  writeProject,
} from '../project/gate-project.ts';

const STATE = 'src/state.txt';
const CLEAN = 'clean\n';

/** The pid the Gate itself observed while its Check ran. */
function observedPid(run: GateRun): number {
  return Number(run.result.scan.source.replace('pid:', ''));
}

function checksOverlap(a: GateRun, b: GateRun): boolean {
  const aStart = Date.parse(a.result.scan.startedAt);
  const aEnd = Date.parse(a.result.scan.finishedAt);
  const bStart = Date.parse(b.result.scan.startedAt);
  const bEnd = Date.parse(b.result.scan.finishedAt);
  return aStart < bEnd && bStart < aEnd;
}

test('in-place mode runs every Gate in the coordinator process, and undo restores the original workspace', async () => {
  await withWorkspace(async root => {
    const config = await writeProject(root, {
      config: { execution: { mode: 'in-place' } },
      files: {
        [STATE]: CLEAN,
        'gates/state.mjs': stateGateModule({
          id: 'state',
          proofs: [proofSource.red('detects BAD', 'state'), proofSource.green('sees the original after undo')],
        }),
      },
    });

    const check = await checkProject(config);
    assert.equal(check.results.length, 1);
    const [run] = check.results;
    assert.equal(run!.result.verdict, 'pass');
    assert.equal(run!.workerPid, process.pid);
    assert.equal(observedPid(run!), process.pid);

    const prove = await proveProject(config);
    assert.equal(prove.exitCode, 0);
    assert.deepEqual(
      prove.outcomes.map(outcome => [outcome.proof, proofEstablished(outcome), outcome.workerPid]),
      [['detects BAD', true, process.pid], ['sees the original after undo', true, process.pid]],
    );
    assert.equal(await readFile(join(root, STATE), 'utf8'), CLEAN);
  });
});

test('copies mode runs each Gate in its own child process against a copy, and reports results in discovery order', async () => {
  await withWorkspace(async root => {
    const config = await writeProject(root, {
      config: { execution: { mode: 'copies', maxAtOnce: 3 } },
      files: {
        [STATE]: CLEAN,
        'gates/alpha.mjs': stateGateModule({ id: 'alpha', delayMs: 300, marker: 'ran-here.txt' }),
        'gates/beta.mjs': stateGateModule({ id: 'beta', delayMs: 100, marker: 'ran-here.txt' }),
        'gates/gamma.mjs': stateGateModule({ id: 'gamma', delayMs: 200, marker: 'ran-here.txt' }),
      },
    });

    const run = await checkProject(config);

    assert.deepEqual(run.results.map(item => item.module.gate.id), ['alpha', 'beta', 'gamma']);
    assert.deepEqual(run.results.map(item => item.result.verdict), ['pass', 'pass', 'pass']);
    assert.equal(run.exitCode, 0);

    for (const item of run.results) {
      assert.notEqual(item.workerPid, process.pid, `${item.module.gate.id} ran in the coordinator`);
      assert.equal(observedPid(item), item.workerPid, `${item.module.gate.id} reports a pid it did not run in`);
    }
    assert.equal(new Set(run.results.map(item => item.workerPid)).size, 3, 'each Gate needs its own child process');

    await assert.rejects(stat(join(root, 'ran-here.txt')), 'a Gate ran against the original tree');

    const [alpha, beta, gamma] = run.results as [GateRun, GateRun, GateRun];
    assert.ok(
      checksOverlap(alpha, beta) || checksOverlap(alpha, gamma) || checksOverlap(beta, gamma),
      'expected at least two Gate Checks to overlap under maxAtOnce 3',
    );
  });
});

test('copies mode runs at most maxAtOnce Gates at a time', async () => {
  await withWorkspace(async root => {
    const config = await writeProject(root, {
      config: { execution: { mode: 'copies', maxAtOnce: 1 } },
      files: {
        [STATE]: CLEAN,
        'gates/alpha.mjs': stateGateModule({ id: 'alpha', delayMs: 200 }),
        'gates/beta.mjs': stateGateModule({ id: 'beta', delayMs: 200 }),
      },
    });

    const run = await checkProject(config);
    const [alpha, beta] = run.results as [GateRun, GateRun];

    assert.equal(run.results.length, 2);
    assert.equal(checksOverlap(alpha, beta), false, 'two Gate Checks overlapped under maxAtOnce 1');
  });
});

test('copies mode reuses one Gate copy across proofs and returns to the baseline after each undo', async () => {
  await withWorkspace(async root => {
    const config = await writeProject(root, {
      config: { execution: { mode: 'copies', maxAtOnce: 2 } },
      files: {
        [STATE]: CLEAN,
        'gates/state.mjs': stateGateModule({
          id: 'state',
          proofs: [
            proofSource.red('first RED reuses the Gate copy', 'state'),
            proofSource.red('second RED starts from the same clean baseline', 'state'),
            proofSource.green('GREEN sees the baseline after both undos'),
          ],
        }),
      },
    });

    const run = await proveProject(config);

    assert.equal(run.exitCode, 0);
    assert.deepEqual(
      run.outcomes.map(outcome => [outcome.proof, outcome.status, proofEstablished(outcome)]),
      [
        ['first RED reuses the Gate copy', 'completed', true],
        ['second RED starts from the same clean baseline', 'completed', true],
        ['GREEN sees the baseline after both undos', 'completed', true],
      ],
    );
    assert.equal(new Set(run.outcomes.map(outcome => outcome.workerPid)).size, 1, 'one child process per Gate');
    assert.notEqual(run.outcomes[0]!.workerPid, process.pid);
    assert.equal(await readFile(join(root, STATE), 'utf8'), CLEAN);
  });
});

test('copies mode rejects a proof whose undo leaves the Gate copy stale, and does not reuse that copy', async () => {
  await withWorkspace(async root => {
    const config = await writeProject(root, {
      config: { execution: { mode: 'copies', maxAtOnce: 1 } },
      files: {
        [STATE]: CLEAN,
        'gates/state.mjs': stateGateModule({
          id: 'state',
          proofs: [
            proofSource.redWithBrokenUndo('detects a stale copy after a broken undo', 'state'),
            proofSource.green('must not run after the Gate copy becomes stale'),
          ],
        }),
      },
    });

    const run = await proveProject(config);

    assert.equal(run.exitCode, 1);
    assert.equal(run.outcomes.length, 1, 'the stale Gate copy must not be reused for later proofs');
    const outcome = run.outcomes[0]!;
    assert.equal(outcome.status, 'unrestored');
    if (outcome.status !== 'unrestored') throw new Error('unreachable');
    assert.equal(outcome.error.code, 'workspace-not-restored');
    assert.match(outcome.error.detail ?? '', /modified src\/state\.txt/);
    assert.equal(outcome.result.verdict, 'fail');
    assert.equal(await readFile(join(root, STATE), 'utf8'), CLEAN, 'the original workspace must stay untouched');
  });
});

test('a Gate that throws inside a child worker fails the run with its own error', async () => {
  await withWorkspace(async root => {
    const config = await writeProject(root, {
      config: { execution: { mode: 'copies', maxAtOnce: 1 } },
      files: { 'gates/boom.mjs': throwingGateModule('boom', 'the Check exploded') },
    });

    await assert.rejects(checkProject(config), /the Check exploded/);
  });
});

test('prove rejects a project with Gates but no Proofs', async () => {
  await withWorkspace(async root => {
    const config = await writeProject(root, {
      config: { execution: { mode: 'in-place' } },
      files: { [STATE]: CLEAN, 'gates/state.mjs': stateGateModule({ id: 'state' }) },
    });

    await assert.rejects(proveProject(config), /No Proofs found/);
  });
});

test('Gate files narrow check and prove to the selected Gates, and an unknown file is a selection error', async () => {
  await withWorkspace(async root => {
    const config = await writeProject(root, {
      config: { execution: { mode: 'in-place' } },
      files: {
        [STATE]: CLEAN,
        'gates/alpha.mjs': stateGateModule({
          id: 'alpha',
          proofs: [proofSource.red('alpha red', 'alpha'), proofSource.green('alpha green')],
        }),
        'gates/beta.mjs': stateGateModule({
          id: 'beta',
          proofs: [proofSource.red('beta red', 'beta'), proofSource.green('beta green')],
        }),
      },
    });

    const check = await checkProject(config, ['gates/beta.mjs']);
    assert.deepEqual(check.results.map(item => item.module.gate.id), ['beta']);

    const all = await proveProject(config);
    assert.equal(all.outcomes.length, 4);

    const one = await proveProject(config, ['gates/alpha.mjs']);
    assert.deepEqual(one.outcomes.map(outcome => outcome.gate), ['alpha', 'alpha']);

    await assert.rejects(checkProject(config, ['gates/missing.mjs']), GateSelectionError);
    await assert.rejects(proveProject(config, ['gates/missing.mjs']), GateSelectionError);
  });
});

test('the exit code follows the verdicts of the selected Gates and the configured refusalExit', async () => {
  await withWorkspace(async root => {
    const config = await writeProject(root, {
      config: { execution: { mode: 'in-place' }, refusalExit: 7 },
      files: {
        'gates/a-pass.mjs': verdictGateModule('a-pass', 'pass'),
        'gates/b-fail.mjs': verdictGateModule('b-fail', 'fail'),
        'gates/c-refuse.mjs': verdictGateModule('c-refuse', 'refuse'),
      },
    });

    const all = await checkProject(config);
    assert.deepEqual(all.results.map(item => item.result.verdict), ['pass', 'fail', 'refuse']);
    assert.equal(all.exitCode, 7);

    assert.equal((await checkProject(config, ['gates/b-fail.mjs'])).exitCode, 1);
    assert.equal((await checkProject(config, ['gates/a-pass.mjs'])).exitCode, 0);
  });
});
