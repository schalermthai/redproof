import { isAbsolute, normalize } from 'node:path';

/** What the sandbox copy does with a directory entry, decided by name only. */
export type CopyDisposition = 'copy' | 'skip' | 'link';

const SKIPPED = new Set(['.git', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.hypothesis']);
const LINKED = new Set(['.venv', 'venv', 'env', 'node_modules', '.tox', '.nox']);

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
