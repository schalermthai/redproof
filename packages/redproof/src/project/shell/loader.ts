import { glob, stat } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RedproofConfig, ResolvedExecutionConfig } from '../../composition/config.ts';
import { resolveConfig } from '../../composition/config.ts';
import type { Gate } from '../../domain/gate.ts';
import type { ProofSuite } from '../../domain/proof.ts';

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

/** A named Gate file did not match any discovered Gate. This is a usage error, not a crash. */
export class GateSelectionError extends Error {}

async function unmatched(gateFile: string, target: string): Promise<GateSelectionError> {
  const exists = await stat(target).then(() => true, () => false);
  return new GateSelectionError(
    exists
      ? `${gateFile} is not a discovered Gate. gatesRoot does not match it.`
      : `No Gate matched: ${gateFile}`,
  );
}

/**
 * Narrow a loaded project to the named Gate files. An empty selection keeps
 * every discovered Gate. A name that matches no discovered Gate is an error,
 * never an empty run.
 */
export async function selectGateModules(
  project: LoadedProject,
  gateFiles: readonly string[],
): Promise<readonly LoadedGateModule[]> {
  if (gateFiles.length === 0) return project.modules;

  const selected = new Set<LoadedGateModule>();
  for (const gateFile of gateFiles) {
    const target = isAbsolute(gateFile) ? resolve(gateFile) : resolve(project.root, gateFile);
    const matched = project.modules.filter(module => resolve(module.file) === target);
    if (matched.length === 0) throw await unmatched(gateFile, target);
    for (const module of matched) selected.add(module);
  }

  return project.modules.filter(module => selected.has(module));
}
