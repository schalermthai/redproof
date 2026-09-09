import { ESLint } from 'eslint';
import { isAbsolute } from 'node:path';
import {
  counting,
  defineAdapter,
  defineRules,
  result,
  type Adapter,
  type NoUnknownKeys,
  type Rule,
  rejectUnknownKeys,
} from 'redproof';
import { eslintBreaches, fatalEslintDiagnostic } from './model.ts';

type EslintRuleInput = Readonly<Record<string, string>>;

type EslintRuleCatalog<M extends EslintRuleInput> = {
  readonly [K in keyof M]: Rule<`eslint/${M[K] & string}`>;
};

export type EslintAdapterOptions<M extends EslintRuleInput> = {
  readonly files?: readonly string[];
  readonly rules: M;
};

function now(): string {
  return new Date().toISOString();
}

export function eslint<const O extends EslintAdapterOptions<EslintRuleInput>>(
  options: O & NoUnknownKeys<O, EslintAdapterOptions<EslintRuleInput>>,
): Adapter<EslintRuleCatalog<O['rules']>> {
  type M = O['rules'];
  type Catalog = EslintRuleCatalog<M>;
  type Ref = Catalog[keyof Catalog]['id'];

  rejectUnknownKeys(options, ['files', 'rules'], 'ESLint adapter');
  const configuredRules = Object.entries(options.rules);
  if (configuredRules.length === 0) {
    throw new Error('ESLint adapter requires at least one Redproof rule.');
  }
  for (const [alias, foreignId] of configuredRules) {
    if (!alias.trim() || !foreignId.trim()) {
      throw new Error(`ESLint rule ${JSON.stringify(alias)} must name a non-empty rule.`);
    }
  }
  for (const file of options.files ?? []) {
    if (!file.trim() || isAbsolute(file)) {
      throw new Error('ESLint files must contain non-empty relative paths.');
    }
  }

  const rules = defineRules(Object.fromEntries(
    configuredRules.map(([alias, foreignId]) => [
      alias,
      {
        id: `eslint/${foreignId}`,
        description: `ESLint rule ${foreignId} must hold.`,
      },
    ]),
  ) as Catalog);

  const byForeignId = new Map<string, Rule<Ref>>();
  for (const [alias, foreignId] of configuredRules) {
    byForeignId.set(foreignId, rules[alias as keyof M] as Rule<Ref>);
  }

  const lintFiles = [...(options.files ?? ['.'])];

  return defineAdapter({
    kind: 'eslint',
    rules,
    check: {
      description: `run ESLint against ${lintFiles.join(', ')} and report configured rule breaches`,
      counting: counting.supported,

      async run(ctx) {
        const startedAt = now();

        try {
          const engine = new ESLint({
            cwd: ctx.root,
            overrideConfig: {
              rules: Object.fromEntries(
                Object.values(options.rules).map(ruleId => [ruleId, 'error']),
              ),
            },
          });

          const lintResults = await engine.lintFiles(lintFiles);
          const finishedAt = now();
          const scan = {
            source: 'eslint',
            startedAt,
            finishedAt,
            inspected: lintResults.length,
          } as const;

          const fatal = fatalEslintDiagnostic(ctx.root, lintResults);
          if (fatal) return result.refuse(scan, fatal);

          return result.fromBreaches(scan, eslintBreaches(ctx.root, lintResults, byForeignId));
        } catch (error) {
          const finishedAt = now();
          return result.refuse(
            {
              source: 'eslint',
              startedAt,
              finishedAt,
              inspected: null,
            },
            {
              code: 'eslint-unavailable',
              message: 'ESLint could not complete the check.',
              location: null,
              detail: error instanceof Error ? error.message : String(error),
            },
          );
        }
      },
    },
  });
}
