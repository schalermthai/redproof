import type { CheckResult } from '../../domain/index.ts';
import type { ProofOutcome } from '../../proof/core/index.ts';
import type { TreeStamp } from '../../workspace/core/index.ts';

export type CheckGateJob = {
  readonly kind: 'check';
  readonly gateFile: string;
  readonly root: string;
};

export type ProveGateJob = {
  readonly kind: 'prove';
  readonly gateFile: string;
  readonly root: string;
  readonly baseline: TreeStamp;
};

export type GateWorkerJob = CheckGateJob | ProveGateJob;

export type CheckGateWorkerResult = {
  readonly kind: 'check-result';
  readonly result: CheckResult;
  readonly durationMs: number;
  readonly workerPid: number;
};

export type ProveGateWorkerResult = {
  readonly kind: 'prove-result';
  readonly outcomes: readonly ProofOutcome[];
  readonly workerPid: number;
};

export type GateWorkerFailure = {
  readonly kind: 'worker-failure';
  readonly message: string;
  readonly stack?: string;
  readonly workerPid: number;
};

export type GateWorkerResult = CheckGateWorkerResult | ProveGateWorkerResult | GateWorkerFailure;
