import type {
  Adapter,
  Check,
  Gate,
  GatePolicies,
  RuleCatalog,
  RuleRefOfCatalog,
} from '../../domain/index.ts';
import { rejectUnknownKeys } from './options.ts';

export type NativeGateDefinition<C extends RuleCatalog> = {
  readonly id: string;
  readonly rules: C;
  readonly check: Check<RuleRefOfCatalog<C>>;
  readonly policies?: GatePolicies;
};

const GATE_KEYS = ['id', 'adapter', 'policies'] as const;
const NATIVE_GATE_KEYS = ['id', 'rules', 'check', 'policies'] as const;
const POLICY_KEYS = ['emptyEvidence'] as const;
const EMPTY_EVIDENCE_POLICIES = ['refuse', 'allow'] as const;

function validatePolicies(policies: GatePolicies | undefined): void {
  if (policies === undefined) return;
  rejectUnknownKeys(policies, POLICY_KEYS, 'policies');
  const { emptyEvidence } = policies;
  if (emptyEvidence !== undefined && !EMPTY_EVIDENCE_POLICIES.includes(emptyEvidence)) {
    throw new Error("policies.emptyEvidence must be 'refuse' or 'allow'.");
  }
}

export function defineGate<const A extends Adapter<any>>(gate: Gate<A>): Gate<A>;
export function defineGate<const C extends RuleCatalog>(gate: NativeGateDefinition<C>): Gate<Adapter<C>>;
export function defineGate(
  gate: Gate<Adapter<any>> | NativeGateDefinition<RuleCatalog>,
): Gate<Adapter<any>> {
  rejectUnknownKeys(gate, 'adapter' in gate ? GATE_KEYS : NATIVE_GATE_KEYS, 'Gate');
  validatePolicies(gate.policies);
  if ('adapter' in gate) return gate;

  return {
    id: gate.id,
    adapter: {
      kind: 'native',
      rules: gate.rules,
      check: gate.check,
    },
    ...(gate.policies === undefined ? {} : { policies: gate.policies }),
  };
}
