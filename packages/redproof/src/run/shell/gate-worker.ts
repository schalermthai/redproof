import { performance } from 'node:perf_hooks';
import { loadGateModule } from '../../project/index.ts';
import type { ProofOutcome } from '../../proof/index.ts';
import { canReuseWorkspace, verifyProofRestoration, runGate, runProof } from '../../proof/index.ts';
import type { GateWorkerJob, GateWorkerResult } from '../core/protocol.ts';
import { verifyTree } from '../../workspace/index.ts';

function send(result: GateWorkerResult): void {
  if (!process.send) throw new Error('Gate worker requires an IPC channel.');
  process.send(result);
}

async function execute(job: GateWorkerJob): Promise<GateWorkerResult> {
  const module = await loadGateModule(job.gateFile);

  if (job.kind === 'check') {
    const started = performance.now();
    const result = await runGate(module.gate, job.root);
    return {
      kind: 'check-result',
      result,
      durationMs: performance.now() - started,
      workerPid: process.pid,
    };
  }

  const outcomes: ProofOutcome[] = [];
  for (const proof of module.proofs?.proofs ?? []) {
    const outcome = verifyProofRestoration(
      await runProof(module.gate, proof, job.root),
      await verifyTree(job.root, job.baseline),
      process.pid,
    );

    outcomes.push(outcome);
    if (!canReuseWorkspace(outcome)) break;
  }

  return { kind: 'prove-result', outcomes, workerPid: process.pid };
}

process.once('message', async message => {
  try {
    send(await execute(message as GateWorkerJob));
  } catch (error) {
    send({
      kind: 'worker-failure',
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
      workerPid: process.pid,
    });
  }
});
