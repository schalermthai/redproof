import { isAbsolute } from 'node:path';
import { rejectUnknownKeys, type Rule } from 'redproof';

export type CosmicRayRuleOptions = {
  readonly mutantsDetected?: true;
  readonly mutationScore?: { readonly minimum: number };
};

export type CosmicRayRuleCatalog<O extends CosmicRayRuleOptions> = {
  readonly [K in keyof O]:
    K extends 'mutantsDetected'
      ? Rule<'cosmic-ray/mutants-detected'>
      : K extends 'mutationScore'
        ? Rule<'cosmic-ray/mutation-score'>
        : never;
};

export type CosmicRayAdapterOptions<O extends CosmicRayRuleOptions> = {
  readonly rules: O;
  /** cosmic-ray TOML configuration, relative to `cwd`. Default `cosmic-ray.toml`. */
  readonly config?: string;
  /** Python interpreter that has cosmic-ray installed. Default `python3`. */
  readonly python?: string;
  /** Relative to the Gate root and confined inside it. Defaults to the root. */
  readonly cwd?: string;
  /** Whole-run limit. Default 30 minutes. */
  readonly timeoutMs?: number;
  /** Capture limit for the dump, which carries every test output. Default 64 MiB. */
  readonly maxOutputBytes?: number;
};

export type CosmicRayConfig = {
  readonly python: string;
  readonly config: string;
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly rules: CosmicRayRuleOptions;
  readonly catalog: Readonly<Record<string, Rule>>;
};

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

const RULE_NAMES = ['mutantsDetected', 'mutationScore'] as const;

function relativePath(name: string, path: unknown): void {
  if (typeof path !== 'string' || !path.trim() || path.includes('\0') || isAbsolute(path)
    || /^[A-Za-z]:/u.test(path) || path.split(/[\\/]/u).includes('..')) {
    throw new Error(`cosmic-ray ${name} must be a confined relative path.`);
  }
}

function positiveInteger(name: string, value: unknown): void {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`cosmic-ray ${name} must be a positive integer.`);
  }
}

/** Reject an option the adapter cannot honour before any Gate runs. */
export function parseCosmicRayOptions(
  options: CosmicRayAdapterOptions<CosmicRayRuleOptions>,
): CosmicRayConfig {
  rejectUnknownKeys(options, ['rules', 'config', 'python', 'cwd', 'timeoutMs', 'maxOutputBytes'], 'cosmic-ray adapter');
  rejectUnknownKeys(options.rules, RULE_NAMES, 'cosmic-ray rule');

  if (!options.rules.mutantsDetected && !options.rules.mutationScore) {
    throw new Error('cosmic-ray adapter requires at least one Redproof rule.');
  }
  if (options.rules.mutationScore) {
    rejectUnknownKeys(options.rules.mutationScore, ['minimum'], 'cosmic-ray mutationScore');
    const { minimum } = options.rules.mutationScore;
    if (!Number.isFinite(minimum) || minimum < 0 || minimum > 100) {
      throw new Error('cosmic-ray mutationScore.minimum must be between 0 and 100.');
    }
  }
  if (options.config !== undefined) relativePath('config', options.config);
  if (options.cwd !== undefined) relativePath('cwd', options.cwd);
  if (options.python !== undefined && (typeof options.python !== 'string' || !options.python.trim())) {
    throw new Error('cosmic-ray python must be a non-empty string.');
  }
  if (options.timeoutMs !== undefined) positiveInteger('timeoutMs', options.timeoutMs);
  if (options.maxOutputBytes !== undefined) positiveInteger('maxOutputBytes', options.maxOutputBytes);

  const catalog: Record<string, Rule> = {};
  if (options.rules.mutantsDetected) {
    catalog.mutantsDetected = {
      id: 'cosmic-ray/mutants-detected',
      description: 'Every cosmic-ray mutant must be killed by the test suite.',
    };
  }
  if (options.rules.mutationScore) {
    catalog.mutationScore = {
      id: 'cosmic-ray/mutation-score',
      description: `Mutation score must be at least ${options.rules.mutationScore.minimum}%.`,
    };
  }

  return {
    python: options.python ?? 'python3',
    config: options.config ?? 'cosmic-ray.toml',
    cwd: options.cwd ?? '.',
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxOutputBytes: options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    rules: options.rules,
    catalog,
  };
}

/** `python -m cosmic_ray.cli <step> ...`, so only the interpreter has to be found, not a console script. */
export function cosmicRayArgs(step: 'baseline' | 'init' | 'exec' | 'dump', config: string, session?: string): readonly string[] {
  const base = ['-m', 'cosmic_ray.cli', step];
  switch (step) {
    case 'baseline': return [...base, config];
    case 'dump': return [...base, session ?? ''];
    default: return [...base, config, session ?? ''];
  }
}
