import type { ResolvedExecutionConfig } from '../../composition/core/index.ts';
import type { Gate, ProofSuite } from '../../domain/index.ts';

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

export type GateModuleExports = {
  readonly default?: unknown;
  readonly proofs?: unknown;
};

/** Validate the exports of one imported Gate module. */
export function gateModuleFrom(file: string, exports: GateModuleExports): LoadedGateModule {
  if (!exports.default) throw new Error(`Gate module ${file} must default-export a Gate.`);

  const gate = exports.default as Gate<any>;
  const proofs = exports.proofs as ProofSuite | undefined;

  if (proofs && proofs.gate !== gate) {
    throw new Error(`Gate module ${file} exports proofs for a different Gate instance.`);
  }

  return proofs ? { file, gate, proofs } : { file, gate };
}

/** Order discovered Gate files deterministically. Discovering none is an error, never an empty project. */
export function gateFilesFrom(
  projectRoot: string,
  patterns: readonly string[],
  discovered: readonly string[],
): readonly string[] {
  const files = [...new Set(discovered)].sort();
  if (files.length === 0) {
    throw new Error(
      `No Gate modules found under ${projectRoot} for ${patterns.map(pattern => JSON.stringify(pattern)).join(', ')}.`,
    );
  }
  return files;
}
