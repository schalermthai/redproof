export type TreeStamp = {
  readonly digest: string;
  readonly entries: number;
};

export type Freshness =
  | { readonly kind: 'fresh' }
  | { readonly kind: 'stale'; readonly why: string };

/** Pure comparison of a workspace baseline with its current tree stamp. */
export function assessFreshness(baseline: TreeStamp, current: TreeStamp): Freshness {
  if (current.digest === baseline.digest && current.entries === baseline.entries) {
    return { kind: 'fresh' };
  }

  return {
    kind: 'stale',
    why: `workspace changed from ${baseline.digest.slice(0, 12)} to ${current.digest.slice(0, 12)}`,
  };
}
