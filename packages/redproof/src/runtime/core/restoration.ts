export type TreeStamp = {
  readonly digest: string;
  readonly entries: number;
  readonly fingerprints?: Readonly<Record<string, string>>;
};

export type Freshness =
  | { readonly kind: 'fresh' }
  | { readonly kind: 'stale'; readonly why: string };

const MAX_CHANGED_PATHS = 8;

function changedPaths(baseline: TreeStamp, current: TreeStamp): string {
  if (!baseline.fingerprints || !current.fingerprints) return '';

  const paths = [...new Set([
    ...Object.keys(baseline.fingerprints),
    ...Object.keys(current.fingerprints),
  ])].sort();
  const changes: string[] = [];

  for (const path of paths) {
    if (!Object.hasOwn(baseline.fingerprints, path)) changes.push(`added ${path}`);
    else if (!Object.hasOwn(current.fingerprints, path)) changes.push(`removed ${path}`);
    else if (baseline.fingerprints[path] !== current.fingerprints[path]) changes.push(`modified ${path}`);
  }

  const shown = changes.slice(0, MAX_CHANGED_PATHS);
  const omitted = changes.length - shown.length;
  return shown.length === 0
    ? ''
    : `; changed paths: ${shown.join(', ')}${omitted > 0 ? `, and ${omitted} more` : ''}`;
}

/** Pure comparison of a workspace baseline with its current tree stamp. */
export function assessFreshness(baseline: TreeStamp, current: TreeStamp): Freshness {
  if (current.digest === baseline.digest && current.entries === baseline.entries) {
    return { kind: 'fresh' };
  }

  return {
    kind: 'stale',
    why: `workspace changed from ${baseline.digest.slice(0, 12)} to ${current.digest.slice(0, 12)}`
      + changedPaths(baseline, current),
  };
}
