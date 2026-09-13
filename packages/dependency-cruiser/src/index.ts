import { resolve } from 'node:path';
import {
  counting,
  defineAdapter,
  type Adapter,
  type NoUnknownKeys,
  type Rule,
} from 'redproof';
import type { DependencyCruiserConfig } from './core/model.ts';
import {
  checkDescription,
  ruleCatalog,
  rulesByForeignName,
  settingsOf,
  validateOptions,
  type DependencyCruiserAdapterOptions,
  type DependencyCruiserRuleCatalog,
  type DependencyCruiserRuleInput,
} from './core/options.ts';
import {
  cruiseVerdict,
  knownViolationsRefusal,
  ruleAvailabilityRefusal,
  unavailableRefusal,
} from './core/outcome.ts';
import { loadDependencyCruiser, now, readKnownViolations, withCwd } from './shell/tool.ts';

export type { DependencyCruiserAdapterOptions } from './core/options.ts';

export function dependencyCruiser<
  const O extends DependencyCruiserAdapterOptions<DependencyCruiserRuleInput>,
>(
  options: O
    & NoUnknownKeys<O, DependencyCruiserAdapterOptions<DependencyCruiserRuleInput>>,
): Adapter<DependencyCruiserRuleCatalog<O['rules']>> {
  type Catalog = DependencyCruiserRuleCatalog<O['rules']>;
  type Ref = Catalog[keyof Catalog]['id'];

  validateOptions(options);
  const rules = ruleCatalog(options.rules) as Catalog;
  const byForeignRule = rulesByForeignName(options.rules, rules) as ReadonlyMap<string, Rule<Ref>>;
  const settings = settingsOf(options);

  return defineAdapter({
    kind: 'dependency-cruiser',
    rules,
    check: {
      description: checkDescription(settings.files),
      counting: counting.supported,

      async run(ctx) {
        const startedAt = now();
        const time = () => ({ startedAt, finishedAt: now() });

        try {
          return await withCwd(ctx.root, async () => {
            const tool = await loadDependencyCruiser(ctx.root);
            const configPath = resolve(ctx.root, settings.configFile);
            const config = await tool.extractConfig(configPath) as DependencyCruiserConfig;
            const unavailableRule = ruleAvailabilityRefusal(
              config,
              settings.foreignRules,
              settings.configFile,
              time(),
            );
            if (unavailableRule) return unavailableRule;

            const cruiseOptions = await tool.extractOptions(configPath);
            const baselineFile = settings.knownViolationsFile;
            const knownViolations = baselineFile
              ? await readKnownViolations(resolve(ctx.root, baselineFile))
              : undefined;
            if (knownViolations instanceof Error) {
              return knownViolationsRefusal(baselineFile!, knownViolations, time());
            }

            const cruised = await tool.cruise(
              [...settings.files],
              {
                ...cruiseOptions,
                cache: false,
                ...(knownViolations ? { ignoreKnown: true, knownViolations } : {}),
                outputType: 'json',
              },
            );
            return cruiseVerdict(cruised.output, byForeignRule, time());
          });
        } catch (error) {
          return unavailableRefusal(error, time());
        }
      },
    },
  });
}

export type { DependencyCruiserViolation } from './core/model.ts';
