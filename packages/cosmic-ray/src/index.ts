import { type Adapter, type NoUnknownKeys } from 'redproof';
import {
  type CosmicRayAdapterOptions,
  type CosmicRayRuleCatalog,
  type CosmicRayRuleOptions,
} from './core/options.ts';
import { createCosmicRayAdapter } from './shell/adapter.ts';
import { runCosmicRayCommand } from './shell/run.ts';

export function cosmicRay<const O extends CosmicRayAdapterOptions<CosmicRayRuleOptions>>(
  options: O
    & NoUnknownKeys<O, CosmicRayAdapterOptions<CosmicRayRuleOptions>>
    & { readonly rules: NoUnknownKeys<O['rules'], CosmicRayRuleOptions> },
): Adapter<CosmicRayRuleCatalog<O['rules']>> {
  return createCosmicRayAdapter<O>(options, runCosmicRayCommand);
}

export type { CosmicRayMutant, CosmicRayStatus } from './core/report.ts';
export type { CosmicRayAdapterOptions, CosmicRayRuleCatalog, CosmicRayRuleOptions } from './core/options.ts';
