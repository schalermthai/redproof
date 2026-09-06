import type { CheckResult } from '../domain/check.ts';
import type { ProofOutcome } from './core/proof-outcome.ts';
import type { TreeStamp } from './core/restoration.ts';

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
