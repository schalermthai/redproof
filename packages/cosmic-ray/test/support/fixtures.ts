import { readFileSync } from 'node:fs';
import { parseCosmicRayDump, type CosmicRayMutant } from '../../src/core/report.ts';

/** Real `cosmic-ray dump` output captured on a tiny `add(a, b)` module (battle test, cosmic-ray 8.9.0). */
export type FixtureName = 'all-killed' | 'survivors' | 'pending' | 'timeout' | 'worker-exception' | 'no-test' | 'one-survivor' | 'one-timeout' | 'many-timeouts' | 'timeout-and-survivors' | 'incompetent' | 'skipped' | 'partial' | 'oldest-supported-8.3.15' | 'old-format-8.1.0';

export function dumpText(name: FixtureName): string {
  return readFileSync(new URL(`../fixtures/${name}.jsonl`, import.meta.url), 'utf8');
}

export function mutants(name: FixtureName): readonly CosmicRayMutant[] {
  const parsed = parseCosmicRayDump(dumpText(name));
  if (parsed instanceof Error) throw parsed;
  return parsed;
}
