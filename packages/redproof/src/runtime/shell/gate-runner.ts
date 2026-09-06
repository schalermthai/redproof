import type { Adapter } from '../../domain/adapter.ts';
import type { CheckResult } from '../../domain/check.ts';
import type { Gate } from '../../domain/gate.ts';
import type { MutationPlan, UndoMutation } from '../../domain/mutation.ts';
import type { Proof, RedProof } from '../../domain/proof.ts';
import type { RuleRef } from '../../domain/rule.ts';
import { evaluateProof, proofSucceeded } from '../core/proof-evaluation.ts';
import type {
  InfrastructureProofOutcome,
  ProofInfrastructureError,
  ProofOutcome,
} from '../core/proof-outcome.ts';

function ruleRefs(adapter: Adapter<any>): RuleRef[] {
  return Object.values(adapter.rules as Record<string, { readonly id: RuleRef }>).map(rule => rule.id);
}

export async function runGate(gate: Gate<any>, root: string): Promise<CheckResult> {
  return gate.adapter.check.run({ root, rules: ruleRefs(gate.adapter) });
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

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

function targetIsBreached(proof: RedProof, result: CheckResult): boolean {
  return result.verdict === 'fail' && result.breaches.some(item => item.rule === proof.target);
}

function proofError(
  gate: Gate<any>,
  proof: Proof,
  code: ProofInfrastructureError['code'],
  message: string,
  error: unknown,
  result?: CheckResult,
): InfrastructureProofOutcome {
  return {
    status: 'error',
    gate: gate.id,
    proof: proof.name,
    expected: proof.expected,
    ok: false,
    error: { code, message, detail: errorDetail(error) },
    ...(result ? { result } : {}),
    workerPid: process.pid,
  };
}

/** Imperative shell: apply mutation, invoke Check, restore mutation. Proof meaning is delegated to the pure core. */
export async function runProof(gate: Gate<any>, proof: Proof, root: string): Promise<ProofOutcome> {
  if (proof.expected === 'red') {
    let baseline: CheckResult;
    try {
      baseline = await runGate(gate, root);
    } catch (error) {
      return proofError(
        gate,
        proof,
        'check-threw',
        'The baseline Check threw instead of returning a CheckResult.',
        error,
      );
    }

    if (targetIsBreached(proof, baseline)) {
      return {
        status: 'completed',
        gate: gate.id,
        proof: proof.name,
        expected: proof.expected,
        ok: false,
        result: baseline,
        workerPid: process.pid,
      };
    }
  }

  let undos: UndoMutation[];
  try {
    undos = await applyMutations(root, proof.mutate);
  } catch (error) {
    return proofError(gate, proof, 'mutation-apply-failed', 'Proof mutation could not be applied.', error);
  }

  let result: CheckResult;
  try {
    result = await runGate(gate, root);
  } catch (error) {
    try {
      await restoreMutations(undos);
    } catch (restoreError) {
      return proofError(
        gate,
        proof,
        'mutation-restore-failed',
        'The Check threw and the proof mutation could not be restored.',
        restoreError,
      );
    }
    return proofError(gate, proof, 'check-threw', 'The Check threw instead of returning a CheckResult.', error);
  }

  try {
    await restoreMutations(undos);
  } catch (error) {
    return proofError(
      gate,
      proof,
      'mutation-restore-failed',
      'The proof mutation could not restore the workspace.',
      error,
      result,
    );
  }

  const evaluation = evaluateProof(proof, result);
  return {
    status: 'completed',
    gate: gate.id,
    proof: proof.name,
    expected: proof.expected,
    ok: proofSucceeded(evaluation),
    result,
    workerPid: process.pid,
  };
}
