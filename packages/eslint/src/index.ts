import { ESLint } from 'eslint';
import {
  counting,
  defineAdapter,
  type Adapter,
  type NoUnknownKeys,
  rejectUnknownKeys,
} from 'redproof';
import { decideEslintRun, eslintUnavailable } from './core/decide.ts';
import {
  planEslintAdapter,
  type EslintAdapterOptions,
  type EslintRuleCatalog,
  type EslintRuleInput,
} from './core/options.ts';

export type { EslintAdapterOptions } from './core/options.ts';

function now(): string {
  return new Date().toISOString();
}

export function eslint<const O extends EslintAdapterOptions<EslintRuleInput>>(
  options: O & NoUnknownKeys<O, EslintAdapterOptions<EslintRuleInput>>,
): Adapter<EslintRuleCatalog<O['rules']>> {
  rejectUnknownKeys(options, ['files', 'rules'], 'ESLint adapter');
  const plan = planEslintAdapter<O['rules']>(options);

  return defineAdapter({
    kind: 'eslint',
    rules: plan.rules,
    check: {
      description: plan.description,
      counting: counting.supported,

      async run(ctx) {
        const startedAt = now();

        try {
          const engine = new ESLint({
            cwd: ctx.root,
            overrideConfig: {
              languageOptions: {
                parserOptions: {
                  // ESLint's `cwd` does not become the parser's project root.
                  // Keep project-aware parsers (for example TypeScript) inside
                  // the Gate workspace when a check runs from a copy.
                  tsconfigRootDir: ctx.root,
                },
              },
              rules: plan.overrideRules,
            },
          });

          const lintResults = await engine.lintFiles([...plan.lintFiles]);
          return decideEslintRun(ctx.root, lintResults, plan.byForeignId, {
            source: 'eslint',
            startedAt,
            finishedAt: now(),
            inspected: lintResults.length,
          });
        } catch (error) {
          return eslintUnavailable(
            { source: 'eslint', startedAt, finishedAt: now(), inspected: null },
            error,
          );
        }
      },
    },
  });
}
