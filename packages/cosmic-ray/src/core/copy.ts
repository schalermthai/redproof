import { isAbsolute, normalize } from 'node:path';
import type { CosmicRayMutant } from './report.ts';

/** What the sandbox copy does with a directory entry, decided by name only. */
export type CopyDisposition = 'copy' | 'skip' | 'link';

const SKIPPED = new Set(['.git', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.hypothesis']);
// `env` is deliberately not here: it is a common name for a real source package, and a link would let a mutation write through to it.
const LINKED = new Set(['.venv', 'venv', 'node_modules', '.tox', '.nox']);

/**
 * cosmic-ray mutates source files in place, and killing it (a timeout, an abort) leaves them mutated.
 * So it runs on a copy. History and caches are skipped; environments and dependency trees are linked, not copied,
 * so a relative test command such as `.venv/bin/python -m pytest` still works in the copy.
 */
export function copyDisposition(name: string): CopyDisposition {
  if (SKIPPED.has(name) || name.endsWith('.egg-info')) return 'skip';
  return LINKED.has(name) ? 'link' : 'copy';
}

/** A module path that would let cosmic-ray mutate a file outside the copy. */
export function escapesCopy(modulePath: string): boolean {
  if (isAbsolute(modulePath) || /^[A-Za-z]:/u.test(modulePath)) return true;
  const normalized = normalize(modulePath).replaceAll('\\', '/');
  return normalized === '..' || normalized.startsWith('../');
}

/** The first planned mutant whose module path would be mutated outside the sandbox, by its spelling alone. */
export function firstEscapingModule(mutants: readonly CosmicRayMutant[]): CosmicRayMutant | undefined {
  return mutants.find(mutant => escapesCopy(mutant.modulePath));
}

/** True when `candidate` (already resolved through links) lies inside `root` (also resolved). Both are absolute. */
export function isInsideDirectory(root: string, candidate: string): boolean {
  const base = root.endsWith('/') ? root : `${root}/`;
  return candidate === root || candidate.startsWith(base);
}
