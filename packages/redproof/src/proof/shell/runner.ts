import type {
  Adapter,
  CheckResult,
  Gate,
  MutationPlan,
  UndoMutation,
  Proof,
  RuleRef,
} from '../../domain/index.ts';
import {
  baselineBlocksProof,
  baselineOutcome,
  completedOutcome,
  failedOutcome,
} from '../core/lifecycle.ts';
import { applyInspectionPolicy } from '../core/index.ts';
import type { ProofOutcome } from '../core/outcome.ts';

function ruleRefs(adapter: Adapter<any>): RuleRef[] {
  return Object.values(adapter.rules as Record<string, { readonly id: RuleRef }>).map(rule => rule.id);
}

export async function runGate(gate: Gate<any>, root: string): Promise<CheckResult> {
  const result = await gate.adapter.check.run({ root, rules: ruleRefs(gate.adapter) });
  return applyInspectionPolicy(result, gate.policies?.emptyEvidence ?? 'refuse');
}

async function applyMutations(root: string, plan: MutationPlan | undefined): Promise<UndoMutation[]> {
  if (!plan) return [];
  const mutations = Array.isArray(plan) ? plan : [plan];
  const undos: UndoMutation[] = [];

  try {
    for (const mutation of mutations) undos.push(await mutation.apply(root));
    return undos;
  } catch (error) {
    for (const undo of undos.reverse()) await undo();
    throw error;
  }
}

async function restoreMutations(undos: UndoMutation[]): Promise<void> {
  for (const undo of undos.reverse()) await undo();
}

/** Imperative shell: run each lifecycle step, and let the core decide the outcome. */
export async function runProof(gate: Gate<any>, proof: Proof, root: string): Promise<ProofOutcome> {
  const workerPid = process.pid;

  if (proof.expected === 'red') {
    let baseline: CheckResult;
    try {
      baseline = await runGate(gate, root);
    } catch (error) {
      return failedOutcome(gate, proof, { step: 'baseline', error }, workerPid);
    }
    if (baselineBlocksProof(proof, baseline)) return baselineOutcome(gate, proof, baseline, workerPid);
  }

  let undos: UndoMutation[];
  try {
    undos = await applyMutations(root, proof.mutate);
  } catch (error) {
    return failedOutcome(gate, proof, { step: 'apply', error }, workerPid);
  }

  let result: CheckResult;
  try {
    result = await runGate(gate, root);
  } catch (error) {
    try {
      await restoreMutations(undos);
    } catch (restoreError) {
      return failedOutcome(gate, proof, { step: 'restore-after-check-threw', error: restoreError }, workerPid);
    }
    return failedOutcome(gate, proof, { step: 'check', error }, workerPid);
  }

  try {
    await restoreMutations(undos);
  } catch (error) {
    return failedOutcome(gate, proof, { step: 'restore', error, result }, workerPid);
  }

  return completedOutcome(gate, proof, result, workerPid);
}
