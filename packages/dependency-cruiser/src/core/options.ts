import { isAbsolute } from 'node:path';
import { defineRules, rejectUnknownKeys, type Rule } from 'redproof';

export type DependencyCruiserRuleInput = Readonly<Record<string, string>>;

export type DependencyCruiserRuleCatalog<M extends DependencyCruiserRuleInput> = {
  readonly [K in keyof M]: Rule<`dependency-cruiser/${M[K] & string}`>;
};

export type DependencyCruiserAdapterOptions<M extends DependencyCruiserRuleInput> = {
  readonly files?: readonly string[];
  readonly configFile?: string;
  readonly knownViolationsFile?: string;
  readonly rules: M;
};

export type DependencyCruiserSettings = {
  readonly files: readonly string[];
  readonly configFile: string;
  readonly knownViolationsFile: string | undefined;
  readonly foreignRules: readonly string[];
};

export function validateOptions(
  options: DependencyCruiserAdapterOptions<DependencyCruiserRuleInput>,
): void {
  rejectUnknownKeys(
    options,
    ['files', 'configFile', 'knownViolationsFile', 'rules'],
    'dependency-cruiser adapter',
  );
  const configuredRules = Object.entries(options.rules);
  if (configuredRules.length === 0) {
    throw new Error('dependency-cruiser adapter requires at least one Redproof rule.');
  }
  for (const [alias, foreignName] of configuredRules) {
    if (!alias.trim() || !foreignName.trim()) {
      throw new Error(
        `dependency-cruiser rule ${JSON.stringify(alias)} must name a non-empty rule.`,
      );
    }
  }
  for (const [name, path] of [
    ['configFile', options.configFile],
    ['knownViolationsFile', options.knownViolationsFile],
  ] as const) {
    if (path !== undefined && (!path.trim() || isAbsolute(path))) {
      throw new Error(`dependency-cruiser ${name} must be a relative path.`);
    }
  }
  for (const file of options.files ?? []) {
    if (!file.trim() || isAbsolute(file)) {
      throw new Error('dependency-cruiser files must contain non-empty relative paths.');
    }
  }
}

export function settingsOf(
  options: DependencyCruiserAdapterOptions<DependencyCruiserRuleInput>,
): DependencyCruiserSettings {
  return {
    files: [...(options.files ?? ['src'])],
    configFile: options.configFile ?? '.dependency-cruiser.cjs',
    knownViolationsFile: options.knownViolationsFile,
    foreignRules: Object.values(options.rules),
  };
}

export function ruleCatalog<M extends DependencyCruiserRuleInput>(
  rules: M,
): DependencyCruiserRuleCatalog<M> {
  return defineRules(Object.fromEntries(
    Object.entries(rules).map(([alias, foreignName]) => [
      alias,
      {
        id: `dependency-cruiser/${foreignName}`,
        description: `dependency-cruiser rule ${foreignName} must hold.`,
      },
    ]),
  ) as DependencyCruiserRuleCatalog<M>);
}

export function rulesByForeignName<M extends DependencyCruiserRuleInput>(
  rules: M,
  catalog: DependencyCruiserRuleCatalog<M>,
): ReadonlyMap<string, DependencyCruiserRuleCatalog<M>[keyof M]> {
  return new Map(
    Object.entries(rules).map(([alias, foreignName]) => [foreignName, catalog[alias as keyof M]]),
  );
}

export function checkDescription(files: readonly string[]): string {
  return `run dependency-cruiser against ${files.join(', ')} and report configured rule breaches`;
}
