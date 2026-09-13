import { isAbsolute } from 'node:path';
import { rejectUnknownKeys, type Rule } from 'redproof';

export type StrykerRuleOptions = {
  readonly mutantsDetected?: true;
  readonly noNewUndetectedMutants?: {
    /** JSON baseline path relative to the Stryker working directory. */
    readonly acceptedMutantsFile: string;
  };
  readonly mutationScore?: {
    readonly minimum: number;
  };
};

export type StrykerRuleCatalog<O extends StrykerRuleOptions> = {
  readonly [K in keyof O]:
    K extends 'mutantsDetected'
      ? Rule<'stryker/mutants-detected'>
      : K extends 'noNewUndetectedMutants'
        ? Rule<'stryker/no-new-undetected-mutants'>
        : K extends 'mutationScore'
          ? Rule<'stryker/mutation-score'>
          : never;
};

export type StrykerAdapterOptions<O extends StrykerRuleOptions> = {
  /** Relative to the Gate root and confined inside it. Defaults to the root. */
  readonly cwd?: string;
  readonly configFile?: string;
  readonly rules: O;
};

export type StrykerConfig = {
  readonly cwd: string;
  readonly configFile: string | undefined;
  readonly rules: StrykerRuleOptions;
  readonly catalog: Readonly<Record<string, Rule>>;
};

/** What one mutation run must do, with each selected policy bound to its Rule. */
export type StrykerRunPlan<R extends string> = {
  readonly cwd: string;
  readonly configFile: string | undefined;
  readonly mutantsDetected?: Rule<R>;
  readonly noNewUndetectedMutants?: {
    readonly rule: Rule<R>;
    readonly acceptedMutantsFile: string;
  };
  readonly mutationScore?: {
    readonly rule: Rule<R>;
    readonly minimum: number;
  };
};

const STRYKER_RULE_NAMES = [
  'mutantsDetected',
  'noNewUndetectedMutants',
  'mutationScore',
] as const;

/** Reject an option the adapter cannot honour before any Gate runs. */
export function parseStrykerOptions(
  options: StrykerAdapterOptions<StrykerRuleOptions>,
): StrykerConfig {
  rejectUnknownKeys(options, ['cwd', 'configFile', 'rules'], 'Stryker adapter');
  rejectUnknownKeys(options.rules, STRYKER_RULE_NAMES, 'Stryker rule');

  if (!options.rules.mutantsDetected
    && !options.rules.noNewUndetectedMutants
    && !options.rules.mutationScore) {
    throw new Error('Stryker adapter requires at least one Redproof rule.');
  }

  if (options.rules.mutationScore) {
    rejectUnknownKeys(options.rules.mutationScore, ['minimum'], 'Stryker mutationScore');
    const minimum = options.rules.mutationScore.minimum;
    if (!Number.isFinite(minimum) || minimum < 0 || minimum > 100) {
      throw new Error('Stryker mutationScore.minimum must be between 0 and 100.');
    }
  }
  if (options.rules.noNewUndetectedMutants) {
    rejectUnknownKeys(
      options.rules.noNewUndetectedMutants,
      ['acceptedMutantsFile'],
      'Stryker noNewUndetectedMutants',
    );
    const baselineFile = options.rules.noNewUndetectedMutants.acceptedMutantsFile;
    if (typeof baselineFile !== 'string' || baselineFile.trim() === '' || isAbsolute(baselineFile)) {
      throw new Error(
        'Stryker noNewUndetectedMutants.acceptedMutantsFile must be a non-empty string containing a relative path.',
      );
    }
  }
  for (const [name, path] of [
    ['cwd', options.cwd],
    ['configFile', options.configFile],
  ] as const) {
    if (path !== undefined && (!path.trim() || isAbsolute(path))) {
      throw new Error(`Stryker ${name} must be a relative path.`);
    }
  }

  const catalog: Record<string, Rule> = {};
  if (options.rules.mutantsDetected) {
    catalog.mutantsDetected = {
      id: 'stryker/mutants-detected',
      description: 'All valid Stryker mutants must be detected by the test suite.',
    };
  }
  if (options.rules.noNewUndetectedMutants) {
    catalog.noNewUndetectedMutants = {
      id: 'stryker/no-new-undetected-mutants',
      description: 'No undetected Stryker mutants may appear outside the accepted baseline.',
    };
  }
  if (options.rules.mutationScore) {
    catalog.mutationScore = {
      id: 'stryker/mutation-score',
      description: `Mutation score must be at least ${options.rules.mutationScore.minimum}%.`,
    };
  }

  return {
    cwd: options.cwd ?? '.',
    configFile: options.configFile,
    rules: options.rules,
    catalog,
  };
}

export function strykerRunPlan<R extends string>(
  config: StrykerConfig,
  rules: Readonly<Record<string, Rule<R>>>,
): StrykerRunPlan<R> {
  return {
    cwd: config.cwd,
    configFile: config.configFile,
    ...(rules.mutantsDetected ? { mutantsDetected: rules.mutantsDetected } : {}),
    ...(rules.noNewUndetectedMutants && config.rules.noNewUndetectedMutants
      ? {
          noNewUndetectedMutants: {
            rule: rules.noNewUndetectedMutants,
            acceptedMutantsFile: config.rules.noNewUndetectedMutants.acceptedMutantsFile,
          },
        }
      : {}),
    ...(rules.mutationScore && config.rules.mutationScore
      ? { mutationScore: { rule: rules.mutationScore, minimum: config.rules.mutationScore.minimum } }
      : {}),
  };
}
