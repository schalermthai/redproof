import { isAbsolute, resolve } from 'node:path';
import type { LoadedGateModule, LoadedProject } from './discovery.ts';
import { loadProject } from './discovery.ts';

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

function describeModule(module: LoadedGateModule): GateDescription {
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

export async function describeProject(configPath: string, gateFile?: string): Promise<{
  readonly project: LoadedProject;
  readonly descriptions: readonly GateDescription[];
}> {
  const project = await loadProject(configPath);

  if (!gateFile) {
    return { project, descriptions: describeLoadedProject(project) };
  }

  const target = isAbsolute(gateFile) ? resolve(gateFile) : resolve(project.root, gateFile);
  const matched = project.modules.filter(module => resolve(module.file) === target);

  if (matched.length === 0) {
    throw new Error(`Gate file ${gateFile} was not discovered by gatesRoot.`);
  }

  return {
    project,
    descriptions: matched.map(describeModule),
  };
}
