import { performance } from 'node:perf_hooks';
import type { CheckResult } from '../../domain/check.ts';
import { executionPolicy } from '../core/execution-policy.ts';
import { checkExitCode, proofExitCode } from '../core/exit-code.ts';
import type { ProofOutcome } from '../core/proof-outcome.ts';
import type { LoadedGateModule, LoadedProject } from '../discovery.ts';
import { loadProject } from '../discovery.ts';
import { copyGateWorkspace, pathInsideCopy, releaseGateWorkspace } from '../workspace.ts';
import { runGate, runProof } from './gate-runner.ts';
import { mapLimit, runGateWorker, unwrapWorker } from './worker-process.ts';

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

async function checkInPlace(project: LoadedProject): Promise<GateRun[]> {
  const results: GateRun[] = [];
  for (const module of project.modules) {
    const gateStarted = performance.now();
    const result = await runGate(module.gate, project.root);
    results.push({
      module,
      result,
      durationMs: performance.now() - gateStarted,
      workerPid: process.pid,
    });
  }
  return results;
}

async function checkInCopies(project: LoadedProject, maxAtOnce: number): Promise<GateRun[]> {
  return mapLimit(project.modules, maxAtOnce, async module => {
    const workspace = await copyGateWorkspace(project.root, module.gate.id);
    try {
      const copiedGateFile = pathInsideCopy(project.root, workspace.root, module.file);
      const worker = unwrapWorker(await runGateWorker({
        kind: 'check',
        gateFile: copiedGateFile,
        root: workspace.root,
      }));
      if (worker.kind !== 'check-result') throw new Error('Gate worker returned the wrong result kind.');

      return {
        module,
        result: worker.result,
        durationMs: worker.durationMs,
        workerPid: worker.workerPid,
      };
    } finally {
      await releaseGateWorkspace(workspace);
    }
  });
}

export async function checkProject(configPath: string): Promise<CheckProjectRun> {
  const startedAt = new Date();
  const started = performance.now();
  const project = await loadProject(configPath);
  const policy = executionPolicy(project.execution);

  const results = policy.mode === 'copies'
    ? await checkInCopies(project, policy.maxAtOnce)
    : await checkInPlace(project);

  return {
    project,
    results,
    exitCode: checkExitCode(results.map(item => item.result), project.refusalExit),
    startedAt,
    durationMs: performance.now() - started,
  };
}

async function proveInPlace(project: LoadedProject): Promise<ProofOutcome[]> {
  const outcomes: ProofOutcome[] = [];
  for (const module of project.modules) {
    if (!module.proofs) continue;
    for (const proof of module.proofs.proofs) outcomes.push(await runProof(module.gate, proof, project.root));
  }
  return outcomes;
}

async function proveInCopies(project: LoadedProject, maxAtOnce: number): Promise<ProofOutcome[]> {
  const modules = project.modules.filter(module => module.proofs);
  const perGate = await mapLimit(modules, maxAtOnce, async module => {
    const workspace = await copyGateWorkspace(project.root, module.gate.id);
    try {
      const copiedGateFile = pathInsideCopy(project.root, workspace.root, module.file);
      const worker = unwrapWorker(await runGateWorker({
        kind: 'prove',
        gateFile: copiedGateFile,
        root: workspace.root,
        baseline: workspace.baseline,
      }));
      if (worker.kind !== 'prove-result') throw new Error('Gate worker returned the wrong result kind.');
      return worker.outcomes;
    } finally {
      await releaseGateWorkspace(workspace);
    }
  });

  return perGate.flat();
}

export type ProveProjectRun = {
  readonly project: LoadedProject;
  readonly outcomes: readonly ProofOutcome[];
  readonly exitCode: number;
};

export async function proveProject(configPath: string): Promise<ProveProjectRun> {
  const project = await loadProject(configPath);
  const policy = executionPolicy(project.execution);
  const outcomes = policy.mode === 'copies'
    ? await proveInCopies(project, policy.maxAtOnce)
    : await proveInPlace(project);

  return {
    project,
    outcomes,
    exitCode: proofExitCode(outcomes),
  };
}
