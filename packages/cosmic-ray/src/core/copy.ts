import { isAbsolute } from 'node:path';
import type { CosmicRayMutant } from './report.ts';

/** What the sandbox copy does with a directory entry, decided by name only. */
export type CopyDisposition = 'copy' | 'skip' | 'link';

const SKIPPED = new Set(['.git', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.hypothesis']);
// `env` is deliberately not here: it is a common name for a real source package, and a link would let a mutation write through to it.
const ALWAYS_LINKED = new Set(['node_modules', '.tox', '.nox']);
const MAYBE_ENVIRONMENT = new Set(['.venv', 'venv']);

/**
 * cosmic-ray mutates source files in place, and killing it (a timeout, an abort) leaves them mutated.
 * So it runs on a copy. History and caches are skipped; environments and dependency trees are linked, not copied,
 * so a relative test command such as `.venv/bin/python -m pytest` still works in the copy.
 */
export function copyDisposition(name: string, hasPyvenvCfg = false): CopyDisposition {
  if (SKIPPED.has(name) || name.endsWith('.egg-info')) return 'skip';
  if (ALWAYS_LINKED.has(name)) return 'link';
  // `venv` can be a real source package: only a directory with a pyvenv.cfg is an environment.
  return MAYBE_ENVIRONMENT.has(name) && hasPyvenvCfg ? 'link' : 'copy';
}

/**
 * A module path whose spelling alone lets cosmic-ray mutate a file outside the sandbox. A relative path that climbs (`../mod.py`)
 * may be fine inside a project sub-directory, so only the realpath check after `init` judges those.
 */
export function escapesCopy(modulePath: string): boolean {
  return isAbsolute(modulePath) || /^[A-Za-z]:/u.test(modulePath);
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
