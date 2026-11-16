import {
  counting,
  defineAdapter,
  defineRules,
  type Adapter,
  type Rule,
  type RuleRefOfCatalog,
} from 'redproof';
import {
  parseCosmicRayOptions,
  type CosmicRayAdapterOptions,
  type CosmicRayRuleCatalog,
  type CosmicRayRuleOptions,
} from '../core/options.ts';
import { runCosmicRayCheck, type RunCommand } from './run.ts';

/** Internal composition seam: the command runner can be replaced to exercise decisions without Python. */
export function createCosmicRayAdapter<const O extends CosmicRayAdapterOptions<CosmicRayRuleOptions>>(
  options: O,
  runCommand: RunCommand,
): Adapter<CosmicRayRuleCatalog<O['rules']>> {
  const config = parseCosmicRayOptions(options);
  const rules = defineRules(config.catalog as CosmicRayRuleCatalog<O['rules']>);
  type Ref = RuleRefOfCatalog<CosmicRayRuleCatalog<O['rules']>>;
  const named = rules as unknown as Readonly<Record<string, Rule<Ref>>>;

  return defineAdapter({
    kind: 'cosmic-ray',
    rules,
    check: {
      description: 'run cosmic-ray mutation testing and evaluate surviving mutants and mutation score',
      counting: counting.supported,
      run: ctx => runCosmicRayCheck(ctx, config, {
        ...(named.mutantsDetected ? { mutantsDetected: named.mutantsDetected } : {}),
        ...(named.mutationScore && config.rules.mutationScore
          ? { mutationScore: { rule: named.mutationScore, minimum: config.rules.mutationScore.minimum } }
          : {}),
      }, runCommand),
    },
  });
}
