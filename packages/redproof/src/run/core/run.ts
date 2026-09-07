import type { CheckResult } from '../../domain/check.ts';
import type { LoadedGateModule, LoadedProject } from '../../project/core/discovery.ts';
import type { ProofOutcome } from '../../proof/core/outcome.ts';

export type GateRun = {
  readonly module: LoadedGateModule;
  readonly result: CheckResult;
  readonly durationMs: number;
  readonly workerPid: number;
};

export type CheckProjectRun = {
  readonly project: LoadedProject;
  readonly results: readonly GateRun[];
  readonly exitCode: number;
  readonly startedAt: Date;
  readonly durationMs: number;
};

export type ProveProjectRun = {
  readonly project: LoadedProject;
  readonly outcomes: readonly ProofOutcome[];
  readonly exitCode: number;
};
