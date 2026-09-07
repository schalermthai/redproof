import { isAbsolute, resolve } from 'node:path';
import type { LoadedGateModule, LoadedProject } from './discovery.ts';

/** A named Gate file did not match any discovered Gate. This is a usage error, not a crash. */
export class GateSelectionError extends Error {}

export type GateSelection =
  | { readonly kind: 'selected'; readonly modules: readonly LoadedGateModule[] }
  | { readonly kind: 'unmatched'; readonly gateFile: string; readonly target: string };

/**
 * Narrow a loaded project to the named Gate files. An empty selection keeps
 * every discovered Gate. A name that matches no discovered Gate is reported,
 * never an empty run. Every path here is absolute, so no working directory is read.
 */
export function selectModules(project: LoadedProject, gateFiles: readonly string[]): GateSelection {
  if (gateFiles.length === 0) return { kind: 'selected', modules: project.modules };

  const selected = new Set<LoadedGateModule>();
  for (const gateFile of gateFiles) {
    const target = isAbsolute(gateFile) ? resolve(gateFile) : resolve(project.root, gateFile);
    const matched = project.modules.filter(module => resolve(module.file) === target);
    if (matched.length === 0) return { kind: 'unmatched', gateFile, target };
    for (const module of matched) selected.add(module);
  }

  return { kind: 'selected', modules: project.modules.filter(module => selected.has(module)) };
}

export function unmatchedMessage(gateFile: string, targetExists: boolean): string {
  return targetExists
    ? `${gateFile} is not a discovered Gate. gatesRoot does not match it.`
    : `No Gate matched: ${gateFile}`;
}
