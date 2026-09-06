import { glob } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RedproofConfig, ResolvedExecutionConfig } from '../composition/config.ts';
import { resolveConfig } from '../composition/config.ts';
import type { Gate } from '../domain/gate.ts';
import type { ProofSuite } from '../domain/proof.ts';

export type LoadedProject = {
  readonly root: string;
  readonly refusalExit: number;
  readonly execution: ResolvedExecutionConfig;
  readonly modules: readonly LoadedGateModule[];
};

export type LoadedGateModule = {
  readonly file: string;
  readonly gate: Gate<any>;
  readonly proofs?: ProofSuite;
};

export async function loadGateModule(file: string): Promise<LoadedGateModule> {
  const mod = await import(`${pathToFileURL(file).href}?redproof=${Date.now()}-${Math.random()}`);
  if (!mod.default) throw new Error(`Gate module ${file} must default-export a Gate.`);

  const gate = mod.default as Gate<any>;
  const proofs = mod.proofs as ProofSuite | undefined;

  if (proofs && proofs.gate !== gate) {
    throw new Error(`Gate module ${file} exports proofs for a different Gate instance.`);
  }

  return proofs ? { file, gate, proofs } : { file, gate };
}

export async function loadProject(configPath: string): Promise<LoadedProject> {
  const absoluteConfig = resolve(configPath);
  const imported = await import(`${pathToFileURL(absoluteConfig).href}?redproof=${Date.now()}-${Math.random()}`);
  const config = resolveConfig(imported.default as RedproofConfig);
  const projectRoot = resolve(dirname(absoluteConfig), config.root);

  const files = new Set<string>();
  for (const pattern of config.gatesRoot) {
    for await (const file of glob(pattern, { cwd: projectRoot })) {
      files.add(resolve(projectRoot, file));
    }
  }

  if (files.size === 0) {
    throw new Error(
      `No Gate modules found under ${projectRoot} for ${config.gatesRoot.map(pattern => JSON.stringify(pattern)).join(', ')}.`,
    );
  }

  const modules: LoadedGateModule[] = [];
  for (const file of [...files].sort()) {
    modules.push(await loadGateModule(file));
  }

  return {
    root: projectRoot,
    refusalExit: config.refusalExit,
    execution: config.execution,
    modules,
  };
}
