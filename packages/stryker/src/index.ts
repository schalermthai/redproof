import {
  counting,
  defineAdapter,
  defineRules,
  type Adapter,
  type NoUnknownKeys,
  type Rule,
  type RuleRefOfCatalog,
} from 'redproof';
import type { RunMutationTest } from './core/model.ts';
import {
  parseStrykerOptions,
  strykerRunPlan,
  type StrykerAdapterOptions,
  type StrykerRuleCatalog,
  type StrykerRuleOptions,
} from './core/options.ts';
import { runStrykerCheck, runStrykerEngine } from './shell/run.ts';

export function stryker<const O extends StrykerAdapterOptions<StrykerRuleOptions>>(
  options: O
    & NoUnknownKeys<O, StrykerAdapterOptions<StrykerRuleOptions>>
    & { readonly rules: NoUnknownKeys<O['rules'], StrykerRuleOptions> },
  /** Internal seam: a test replaces the Stryker engine here. */
  runMutationTest: RunMutationTest = runStrykerEngine,
): Adapter<StrykerRuleCatalog<O['rules']>> {
  const config = parseStrykerOptions(options);
  const rules = defineRules(config.catalog as StrykerRuleCatalog<O['rules']>);
  type Ref = RuleRefOfCatalog<StrykerRuleCatalog<O['rules']>>;
  const plan = strykerRunPlan(config, rules as unknown as Readonly<Record<string, Rule<Ref>>>);

  return defineAdapter({
    kind: 'stryker',
    rules,
    check: {
      description: 'run Stryker mutation testing and evaluate undetected mutants and mutation score',
      counting: counting.supported,
      run: ctx => runStrykerCheck(ctx, plan, runMutationTest),
    },
  });
}

export type { AcceptedStrykerMutant } from './core/baseline.ts';
export type { MutationMetrics, StrykerMutantResult, StrykerMutantStatus } from './core/model.ts';
export type { StrykerAdapterOptions, StrykerRuleCatalog, StrykerRuleOptions } from './core/options.ts';
