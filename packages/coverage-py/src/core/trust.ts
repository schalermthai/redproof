import type { CoverageEvidence } from './evidence.ts';
import { coveragePath } from './paths.ts';
import { unavailable, type Refusal } from './refusals.ts';

/** What the shell found when it resolved a reported path on disk: the real path, or why it could not. */
export type Resolved = { readonly real: string } | { readonly error: string };

/** Every directory the shell is about to use (cwd, rcfile's directory) must resolve inside the Gate root. cwd === root is fine. */
export function confineRoots(root: string, cwd: string, rcfile: string | undefined): Refusal | null {
  try {
    if (cwd !== root) coveragePath(root, root, cwd);
    if (rcfile) coveragePath(root, root, rcfile);
    return null;
  } catch (error) { return unavailable(error instanceof Error ? error.message : String(error)); }
}
/** Every file the report lists must exist and, after symlinks are followed, still be inside the Gate root. */
export function trustFiles(root: string, evidence: CoverageEvidence, resolved: ReadonlyMap<string, Resolved>): Refusal | null {
  for (const { file } of evidence.files) {
    const found = resolved.get(file);
    if (!found) return unavailable(`The shell did not resolve ${file}.`);
    if ('error' in found) return unavailable(`${file}: ${found.error}`);
    try { coveragePath(root, root, found.real); }
    catch (error) { return unavailable(`${file}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return null;
}

/** expectedFiles, resolved by the shell: each must exist and stay inside the Gate root after symlinks. Returns the root-relative paths. */
export function confineRequired(root: string, expected: readonly string[], resolved: ReadonlyMap<string, Resolved>):
  { readonly kind: 'confined'; readonly paths: readonly string[] } | Refusal {
  const paths: string[] = [];
  for (const file of expected) {
    const found = resolved.get(file);
    if (!found) return unavailable(`The shell did not resolve expected file ${file}.`);
    if ('error' in found) return unavailable(`expected file ${file}: ${found.error}`);
    try { paths.push(coveragePath(root, root, found.real)); }
    catch (error) { return unavailable(`expected file ${file}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return { kind: 'confined', paths };
}
