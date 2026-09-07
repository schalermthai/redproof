import type { Scan } from '../../domain/index.ts';

export type ScanOptions = {
  /** Defaults to the search kind, `'text'` or `'json'`. */
  readonly source?: string;
  /** Defaults to the moment the search started. Pass an earlier time to widen the window. */
  readonly startedAt?: string;
};

/**
 * Describe one search as a Scan. `inspected` counts the files that search read.
 * A Check that runs several searches must build its own Scan, or its report
 * will under-count.
 */
export type SearchScan = (options?: ScanOptions) => Scan;

export function searchScan(kind: string, startedAt: string, finishedAt: string, inspected: number): SearchScan {
  return (options = {}) => ({
    source: options.source ?? kind,
    startedAt: options.startedAt ?? startedAt,
    finishedAt,
    inspected,
  });
}
