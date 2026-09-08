import { isAbsolute, relative, resolve, sep } from 'node:path';

export type ResolvedStrykerCwd =
  | { readonly kind: 'inside'; readonly path: string }
  | { readonly kind: 'outside'; readonly path: string };

/** Both paths must be absolute. */
function isInsideRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** Resolve and lexically confine a Stryker working directory to the Gate root. */
export function resolveStrykerCwd(
  root: string,
  cwd: string,
): ResolvedStrykerCwd {
  const absoluteRoot = resolve(root);
  const candidate = resolve(absoluteRoot, cwd);
  return isInsideRoot(absoluteRoot, candidate)
    ? { kind: 'inside', path: candidate }
    : { kind: 'outside', path: candidate };
}

/** Confine already-canonical absolute paths, resolving symbolic-link escapes. */
export function confineCanonicalStrykerCwd(
  canonicalRoot: string,
  canonicalCandidate: string,
): ResolvedStrykerCwd {
  return isInsideRoot(canonicalRoot, canonicalCandidate)
    ? { kind: 'inside', path: canonicalCandidate }
    : { kind: 'outside', path: canonicalCandidate };
}
