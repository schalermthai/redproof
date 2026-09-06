import { cruise } from 'dependency-cruiser';
import extractDepcruiseConfig from 'dependency-cruiser/config-utl/extract-depcruise-config';
import extractDepcruiseOptions from 'dependency-cruiser/config-utl/extract-depcruise-options';
import { resolve } from 'node:path';
import {
  counting,
  defineAdapter,
  defineRules,
  result,
  type Adapter,
  type Rule,
} from 'redproof';
import {
  violationsToBreaches,
  type DependencyCruiserViolation,
} from './model.ts';

type DependencyCruiserRuleInput = Readonly<Record<string, string>>;

type DependencyCruiserRuleCatalog<M extends DependencyCruiserRuleInput> = {
  readonly [K in keyof M]: Rule<`dependency-cruiser/${M[K] & string}`>;
};

export type DependencyCruiserAdapterOptions<M extends DependencyCruiserRuleInput> = {
  readonly files?: readonly string[];
  readonly configFile?: string;
  readonly rules: M;
};

type DependencyCruiserConfig = {
  readonly forbidden?: readonly { readonly name?: string }[];
  readonly required?: readonly { readonly name?: string }[];
  readonly allowed?: readonly unknown[];
};

type CruiseOutputLike = {
  readonly summary?: {
    readonly totalCruised?: number;
    readonly violations?: readonly DependencyCruiserViolation[];
  };
};

// dependency-cruiser returns a JSON string for outputType 'json'.
function readCruiseOutput(output: unknown): CruiseOutputLike | null {
  if (typeof output === 'string') {
    try {
      return JSON.parse(output) as CruiseOutputLike;
    } catch {
      return null;
    }
  }

  return typeof output === 'object' && output !== null
    ? output as CruiseOutputLike
    : null;
}

function now(): string {
  return new Date().toISOString();
}

function configuredRuleNames(config: DependencyCruiserConfig): ReadonlySet<string> {
  return new Set([
    ...(config.forbidden ?? []).flatMap(rule => rule.name ? [rule.name] : []),
    ...(config.required ?? []).flatMap(rule => rule.name ? [rule.name] : []),
    ...((config.allowed?.length ?? 0) > 0 ? ['not-in-allowed'] : []),
  ]);
}

function withCwd<T>(root: string, action: () => Promise<T>): Promise<T> {
  const before = process.cwd();
  process.chdir(root);
  return action().finally(() => process.chdir(before));
}

export function dependencyCruiser<const M extends DependencyCruiserRuleInput>(
  options: DependencyCruiserAdapterOptions<M>,
): Adapter<DependencyCruiserRuleCatalog<M>> {
  type Catalog = DependencyCruiserRuleCatalog<M>;
  type Ref = Catalog[keyof Catalog]['id'];

  const rules = defineRules(Object.fromEntries(
    Object.entries(options.rules).map(([alias, foreignName]) => [
      alias,
      {
        id: `dependency-cruiser/${foreignName}`,
        description: `dependency-cruiser rule ${foreignName} must hold.`,
      },
    ]),
  ) as Catalog);

  const byForeignRule = new Map<string, Rule<Ref>>();
  for (const [alias, foreignName] of Object.entries(options.rules)) {
    byForeignRule.set(foreignName, rules[alias as keyof M] as Rule<Ref>);
  }

  const files = [...(options.files ?? ['src'])];
  const configFile = options.configFile ?? '.dependency-cruiser.cjs';

  return defineAdapter({
    kind: 'dependency-cruiser',
    rules,
    check: {
      description: `run dependency-cruiser against ${files.join(', ')} and report configured rule breaches`,
      counting: counting.supported,

      async run(ctx) {
        const startedAt = now();

        try {
          return await withCwd(ctx.root, async () => {
            const configPath = resolve(ctx.root, configFile);
            const config = await extractDepcruiseConfig(configPath) as DependencyCruiserConfig;
            const available = configuredRuleNames(config);
            const missing = Object.values(options.rules).filter(name => !available.has(name));

            if (missing.length > 0) {
              return result.refuse(
                {
                  source: 'dependency-cruiser',
                  startedAt,
                  finishedAt: now(),
                  inspected: null,
                },
                {
                  code: 'dependency-cruiser-rule-missing',
                  message: 'Configured Redproof rules are missing from the dependency-cruiser configuration.',
                  location: { file: configFile, line: null, column: null },
                  detail: `Missing: ${missing.join(', ')}`,
                },
              );
            }

            const cruiseOptions = await extractDepcruiseOptions(configPath);
            const cruiseResult = await cruise(
              files,
              {
                ...cruiseOptions,
                outputType: 'json',
              },
            );

            const output = readCruiseOutput(cruiseResult.output);
            if (!output?.summary || !Array.isArray(output.summary.violations)) {
              return result.refuse(
                {
                  source: 'dependency-cruiser',
                  startedAt,
                  finishedAt: now(),
                  inspected: null,
                },
                {
                  code: 'dependency-cruiser-output-unreadable',
                  message: 'dependency-cruiser completed without a trustworthy structured result.',
                  location: null,
                },
              );
            }

            const scan = {
              source: 'dependency-cruiser',
              startedAt,
              finishedAt: now(),
              inspected: output.summary.totalCruised ?? null,
            } as const;

            return result.fromBreaches(
              scan,
              violationsToBreaches(output.summary.violations, byForeignRule),
            );
          });
        } catch (error) {
          return result.refuse(
            {
              source: 'dependency-cruiser',
              startedAt,
              finishedAt: now(),
              inspected: null,
            },
            {
              code: 'dependency-cruiser-unavailable',
              message: 'dependency-cruiser could not complete the check.',
              location: null,
              detail: error instanceof Error ? error.message : String(error),
            },
          );
        }
      },
    },
  });
}

export type { DependencyCruiserViolation } from './model.ts';
