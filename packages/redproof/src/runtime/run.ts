/**
 * Public runtime facade.
 *
 * Implementation lives in runtime/core and runtime/shell. Keep this file thin so
 * consumers do not depend on that internal architecture.
 */
export type {
  CompletedProofOutcome,
  InfrastructureProofOutcome,
  ProofInfrastructureError,
  ProofOutcome,
} from './core/proof-outcome.ts';
export { runGate, runProof } from './shell/gate-runner.ts';
export type { CheckProjectRun, GateRun, ProveProjectRun } from './shell/project-runner.ts';
export { checkProject, proveProject } from './shell/project-runner.ts';
