import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { StrykerMutantResult } from './model.ts';

export type ResolvedStrykerCwd =
  | { readonly kind: 'inside'; readonly path: string }
  | { readonly kind: 'outside'; readonly path: string };

/** Both paths must be absolute. */
function isInsideRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** Lexically confine a Stryker working directory to an absolute Gate root. */
export function resolveStrykerCwd(
  root: string,
  cwd: string,
): ResolvedStrykerCwd {
  return confineCanonicalStrykerCwd(root, resolve(root, cwd));
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

/** The portable path of an absolute file below an absolute root. */
export function projectRelativeFile(root: string, absoluteFile: string): string {
  return relative(root, absoluteFile).split(sep).join('/');
}

/** A file, resolved from an absolute base, as a portable path below an absolute root; null when it is not below it. */
export function relativeFileInsideRoot(root: string, base: string, file: string): string | null {
  const absoluteFile = resolve(base, file);
  if (absoluteFile === root || !isInsideRoot(root, absoluteFile)) return null;
  return projectRelativeFile(root, absoluteFile);
}

/** Make producer paths stable and meaningful after a Redproof Gate copy is released. */
export function relativizeStrykerMutants(
  gateRoot: string,
  workingDirectory: string,
  mutants: readonly StrykerMutantResult[],
): readonly StrykerMutantResult[] {
  return mutants.map((mutant) => {
    if (!mutant.fileName) return mutant;
    const relativeFile = relativeFileInsideRoot(gateRoot, workingDirectory, mutant.fileName);
    return relativeFile === null ? mutant : { ...mutant, fileName: relativeFile };
  });
}
