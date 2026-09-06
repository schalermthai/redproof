import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { GateWorkerJob, GateWorkerResult } from '../worker-protocol.ts';

export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await run(items[index]!, index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

const gateWorkerFile = fileURLToPath(new URL('../gate-worker.ts', import.meta.url));

export function runGateWorker(job: GateWorkerJob): Promise<GateWorkerResult> {
  return new Promise((resolve, reject) => {
    const child = fork(gateWorkerFile, [], {
      execArgv: ['--disable-warning=ExperimentalWarning', '--experimental-strip-types'],
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });

    let settled = false;

    child.once('message', message => {
      settled = true;
      resolve(message as GateWorkerResult);
      child.disconnect();
    });

    child.once('error', error => {
      if (settled) return;
      settled = true;
      reject(error);
    });

    child.once('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      reject(new Error(`Gate worker exited before returning a result (code=${code ?? 'null'}, signal=${signal ?? 'null'}).`));
    });

    child.send(job);
  });
}

export function unwrapWorker(result: GateWorkerResult): Exclude<GateWorkerResult, { kind: 'worker-failure' }> {
  if (result.kind !== 'worker-failure') return result;
  throw new Error(result.stack ? `${result.message}\n${result.stack}` : result.message);
}
