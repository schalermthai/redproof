import type { LoadedGateModule, LoadedProject } from './discovery.ts';

export type DescribedRule = {
  readonly label: string;
  readonly id: string;
  readonly description: string;
};

export type DescribedProof = {
  readonly kind: 'red' | 'green' | 'refuse';
  readonly name: string;
  readonly targetLabel?: string;
  readonly mutation?: string;
};

export type GateDescription = {
  readonly gate: string;
  readonly rules: readonly DescribedRule[];
  readonly check: string;
  readonly proofs: readonly DescribedProof[];
};

export function describeModule(module: LoadedGateModule): GateDescription {
  const rules = Object.values(
    module.gate.adapter.rules as Readonly<Record<string, { readonly id: string; readonly description: string }>>,
  ).map((rule, index) => ({
    label: `R${index + 1}`,
    id: rule.id,
    description: rule.description,
  }));

  const labels = new Map(rules.map(rule => [rule.id, rule.label]));
  const proofs: DescribedProof[] = [];

  for (const proof of module.proofs?.proofs ?? []) {
    const mutation = proof.mutate
      ? (Array.isArray(proof.mutate) ? proof.mutate : [proof.mutate])
          .map(item => item.description)
          .join('; ')
      : undefined;

    if (proof.expected === 'red') {
      proofs.push({
        kind: 'red',
        name: proof.name,
        targetLabel: labels.get(proof.target) ?? proof.target,
        ...(mutation ? { mutation } : {}),
      });
    } else {
      proofs.push({
        kind: proof.expected,
        name: proof.name,
        ...(mutation ? { mutation } : {}),
      });
    }
  }

  return {
    gate: module.gate.id,
    rules,
    check: module.gate.adapter.check.description,
    proofs,
  };
}

export function describeLoadedProject(project: LoadedProject): readonly GateDescription[] {
  return project.modules.map(describeModule);
}
