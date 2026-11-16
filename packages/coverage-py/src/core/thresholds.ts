/** Threshold arithmetic. Exact, integer-only, and the only place that decides "is this coverage enough". */
export type Count = { readonly total: number; readonly covered: number };

/** Minimums may have at most this many decimals, so the comparison below can be exact integer arithmetic. */
export const MINIMUM_DECIMALS = 6;
const SCALE = 10n ** BigInt(MINIMUM_DECIMALS);

/** coverage.py's convention: nothing to cover is 100% covered. Floor to two decimals, never round up to a pass. */
export function percent(count: Count): number {
  return count.total ? Math.floor((100_000 * count.covered / count.total) / 10) / 100 : 100;
}
/** covered/total < minimum/100, exactly. Float products misjudge exact ties (161/250 is 64.4 %, yet 161*100 < 64.4*250 in floats). */
export function below(count: Count, minimum: number): boolean {
  return count.total > 0 && BigInt(count.covered) * 100n * SCALE < BigInt(Math.round(minimum * Number(SCALE))) * BigInt(count.total);
}
