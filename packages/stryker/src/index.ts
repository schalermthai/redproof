import {
  type Adapter,
  type NoUnknownKeys,
} from 'redproof';
import {
  type StrykerAdapterOptions,
  type StrykerRuleCatalog,
  type StrykerRuleOptions,
} from './core/options.ts';
import { createStrykerAdapter } from './shell/adapter.ts';
import { runStrykerEngine } from './shell/run.ts';

export function stryker<const O extends StrykerAdapterOptions<StrykerRuleOptions>>(
  options: O
    & NoUnknownKeys<O, StrykerAdapterOptions<StrykerRuleOptions>>
    & { readonly rules: NoUnknownKeys<O['rules'], StrykerRuleOptions> },
): Adapter<StrykerRuleCatalog<O['rules']>> {
  return createStrykerAdapter<O>(options, runStrykerEngine);
}

export type { AcceptedStrykerMutant } from './core/baseline.ts';
export type { MutationMetrics, StrykerMutantResult, StrykerMutantStatus } from './core/model.ts';
export type { StrykerAdapterOptions, StrykerRuleCatalog, StrykerRuleOptions } from './core/options.ts';
