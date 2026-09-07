import { join, relative } from 'node:path';

const NEVER_COPIED = new Set(['.git', '.redproof']);

/** Dependencies are linked, not copied, so the root node_modules is skipped. A nested one is a fixture and is copied. */
export function copiesEntry(name: string, atRoot: boolean): boolean {
  return !NEVER_COPIED.has(name) && !(atRoot && name === 'node_modules');
}

/** Reporter output under .redproof is never part of a workspace baseline. */
export function stampsEntry(name: string, atRoot: boolean): boolean {
  return !(atRoot && name === '.redproof');
}

export function copyName(gateId: string): string {
  const safe = gateId.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return safe || 'gate';
}

export function pathInsideCopy(projectRoot: string, workspaceRoot: string, projectFile: string): string {
  return join(workspaceRoot, relative(projectRoot, projectFile));
}
