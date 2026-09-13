import {
  counting,
  defineAdapter,
  defineRules,
  type Adapter,
  type Rule,
  type RuleRefOfCatalog,
} from 'redproof';
import type { RunMutationTest } from '../core/model.ts';
import {
  parseStrykerOptions,
  strykerRunPlan,
  type StrykerAdapterOptions,
  type StrykerRuleCatalog,
  type StrykerRuleOptions,
} from '../core/options.ts';
import { runStrykerCheck } from './run.ts';

/** Internal composition seam for exercising adapter decisions without running Stryker. */
export function createStrykerAdapter<const O extends StrykerAdapterOptions<StrykerRuleOptions>>(
  options: O,
  runMutationTest: RunMutationTest,
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
