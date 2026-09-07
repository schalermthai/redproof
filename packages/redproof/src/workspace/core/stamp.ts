import { createHash } from 'node:crypto';

export type StampEntry =
  | { readonly kind: 'directory'; readonly path: string; readonly mode: number }
  | { readonly kind: 'link'; readonly path: string; readonly mode: number; readonly target: string }
  | { readonly kind: 'file'; readonly path: string; readonly mode: number; readonly contents: Buffer };

/** The exact bytes an entry contributes to a tree digest. Kind, path, mode, and link target or contents all count. */
export function stampRecord(entry: StampEntry): readonly (string | Buffer)[] {
  const mode = entry.mode & 0o777;
  if (entry.kind === 'directory') return [`D\0${entry.path}\0${mode}\0`];
  if (entry.kind === 'link') return [`L\0${entry.path}\0${mode}\0${entry.target}\0`];
  return [`F\0${entry.path}\0${mode}\0`, entry.contents, '\0'];
}

export function fingerprint(record: readonly (string | Buffer)[]): string {
  const hash = createHash('sha256');
  for (const part of record) hash.update(part);
  return hash.digest('hex');
}
