import { isAbsolute, relative, resolve, sep } from 'node:path';

export type ResolvedTestingPath =
  | { readonly kind: 'inside'; readonly path: string }
  | { readonly kind: 'outside'; readonly path: string };

/** Reject a path option whose contract requires a non-empty relative value. */
export function validateRelativeTestingPath(name: string, path: string): void {
  if (!path.trim()) throw new Error(`${name} must not be empty.`);
  if (isAbsolute(path)) throw new Error(`${name} must be relative.`);
}

/** Both paths must be absolute. */
function isInsideRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** Resolve and lexically confine a path to the testing Gate root. */
export function resolveTestingPath(root: string, path: string): ResolvedTestingPath {
  const absoluteRoot = resolve(root);
  const candidate = resolve(absoluteRoot, path);
  return isInsideRoot(absoluteRoot, candidate)
    ? { kind: 'inside', path: candidate }
    : { kind: 'outside', path: candidate };
}

/** Confine already-canonical absolute paths, resolving symbolic-link escapes. */
export function confineCanonicalTestingPath(
  canonicalRoot: string,
  canonicalCandidate: string,
): ResolvedTestingPath {
  return isInsideRoot(canonicalRoot, canonicalCandidate)
    ? { kind: 'inside', path: canonicalCandidate }
    : { kind: 'outside', path: canonicalCandidate };
}
