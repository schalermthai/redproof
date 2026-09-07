import { performance } from 'node:perf_hooks';
import type { CheckResult } from '../../domain/check.ts';
import { executionPolicy } from '../core/policy.ts';
import { checkExitCode, proofExitCode } from '../core/exit-code.ts';
import type { ProofOutcome } from '../../proof/core/outcome.ts';
import type { LoadedGateModule, LoadedProject } from '../../project/shell/loader.ts';
import { loadProject, selectGateModules } from '../../project/shell/loader.ts';
import { copyGateWorkspace, pathInsideCopy, releaseGateWorkspace } from '../../workspace/shell/copy.ts';
import { runGate, runProof } from '../../proof/shell/runner.ts';
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

async function checkInPlace(
  project: LoadedProject,
  modules: readonly LoadedGateModule[],
): Promise<GateRun[]> {
  const results: GateRun[] = [];
  for (const module of modules) {
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

async function checkInCopies(
  project: LoadedProject,
  modules: readonly LoadedGateModule[],
  maxAtOnce: number,
): Promise<GateRun[]> {
  return mapLimit(modules, maxAtOnce, async module => {
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

export async function checkProject(
  configPath: string,
  gateFiles: readonly string[] = [],
): Promise<CheckProjectRun> {
  const startedAt = new Date();
  const started = performance.now();
  const project = await loadProject(configPath);
  const modules = await selectGateModules(project, gateFiles);
  const policy = executionPolicy(project.execution);

  const results = policy.mode === 'copies'
    ? await checkInCopies(project, modules, policy.maxAtOnce)
    : await checkInPlace(project, modules);

  return {
    project,
    results,
    exitCode: checkExitCode(results.map(item => item.result), project.refusalExit),
    startedAt,
    durationMs: performance.now() - started,
  };
}

async function proveInPlace(
  project: LoadedProject,
  modules: readonly LoadedGateModule[],
): Promise<ProofOutcome[]> {
  const outcomes: ProofOutcome[] = [];
  for (const module of modules) {
    if (!module.proofs) continue;
    for (const proof of module.proofs.proofs) outcomes.push(await runProof(module.gate, proof, project.root));
  }
  return outcomes;
}

async function proveInCopies(
  project: LoadedProject,
  modules: readonly LoadedGateModule[],
  maxAtOnce: number,
): Promise<ProofOutcome[]> {
  const perGate = await mapLimit(modules.filter(module => module.proofs), maxAtOnce, async module => {
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

export async function proveProject(
  configPath: string,
  gateFiles: readonly string[] = [],
): Promise<ProveProjectRun> {
  const project = await loadProject(configPath);
  const modules = await selectGateModules(project, gateFiles);
  const proofCount = modules.reduce(
    (count, module) => count + (module.proofs?.proofs.length ?? 0),
    0,
  );
  if (proofCount === 0) {
    throw new Error('No Proofs found. Export a non-empty `proofs` suite from at least one Gate module.');
  }

  const policy = executionPolicy(project.execution);
  const outcomes = policy.mode === 'copies'
    ? await proveInCopies(project, modules, policy.maxAtOnce)
    : await proveInPlace(project, modules);

  return {
    project,
    outcomes,
    exitCode: proofExitCode(outcomes),
  };
}
