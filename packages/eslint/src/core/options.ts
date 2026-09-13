import { isAbsolute } from 'node:path';
import type { Rule } from 'redproof';

export type EslintRuleInput = Readonly<Record<string, string>>;

export type EslintRuleCatalog<M extends EslintRuleInput> = {
  readonly [K in keyof M]: Rule<`eslint/${M[K] & string}`>;
};

export type EslintAdapterOptions<M extends EslintRuleInput> = {
  readonly files?: readonly string[];
  readonly rules: M;
};

export type EslintPlan<M extends EslintRuleInput> = {
  readonly rules: EslintRuleCatalog<M>;
  readonly byForeignId: ReadonlyMap<string, EslintRuleCatalog<M>[keyof M]>;
  readonly lintFiles: readonly string[];
  readonly description: string;
  readonly overrideRules: Readonly<Record<string, 'error'>>;
};

export function planEslintAdapter<M extends EslintRuleInput>(
  options: EslintAdapterOptions<M>,
): EslintPlan<M> {
  type Catalog = EslintRuleCatalog<M>;

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

  const rules = Object.fromEntries(
    configuredRules.map(([alias, foreignId]) => [
      alias,
      {
        id: `eslint/${foreignId}`,
        description: `ESLint rule ${foreignId} must hold.`,
      },
    ]),
  ) as Catalog;

  const byForeignId = new Map<string, Catalog[keyof M]>();
  for (const [alias, foreignId] of configuredRules) {
    byForeignId.set(foreignId, rules[alias as keyof M]);
  }

  const lintFiles = options.files ?? ['.'];

  return {
    rules,
    byForeignId,
    lintFiles,
    description: `run ESLint against ${lintFiles.join(', ')} and report configured rule breaches`,
    overrideRules: Object.fromEntries(configuredRules.map(([, foreignId]) => [foreignId, 'error'])),
  };
}
