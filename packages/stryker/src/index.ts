import { Stryker } from '@stryker-mutator/core';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import {
  counting,
  defineAdapter,
  defineRules,
  result,
  type Adapter,
  type Breach,
  type Diagnostic,
  rejectUnknownKeys,
  type NoUnknownKeys,
  type Rule,
  type RuleCatalog,
  type RuleRefOfCatalog,
} from 'redproof';
import {
  assessStrykerBaseline,
  parseAcceptedStrykerMutants,
  relativizeStrykerMutants,
  type AcceptedStrykerMutant,
  type StrykerBaselineAssessment,
} from './baseline.ts';
import {
  mutationMetrics,
  mutationScoreBreach,
  strykerProgrammaticOptions,
  undetectedMutantBreaches,
  type StrykerMutantResult,
} from './model.ts';
import { confineCanonicalStrykerCwd, resolveStrykerCwd } from './cwd.ts';

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

function now(): string {
  return new Date().toISOString();
}

function refuseBeforeRun(startedAt: string, why: Diagnostic) {
  return result.refuse({ source: 'stryker', startedAt, finishedAt: now(), inspected: null }, why);
}

function cwdOutsideRoot(startedAt: string, path: string) {
  return refuseBeforeRun(startedAt, {
    code: 'stryker-cwd-outside-root',
    message: 'The Stryker working directory resolves outside the Gate root.',
    location: null,
    detail: path,
  });
}

function projectRelativeFile(root: string, absoluteFile: string): string {
  return relative(root, absoluteFile).split(sep).join('/');
}

type LoadedBaseline =
  | { readonly kind: 'loaded'; readonly accepted: readonly AcceptedStrykerMutant[] }
  | { readonly kind: 'outside'; readonly path: string }
  | { readonly kind: 'invalid'; readonly detail: string };

/** The baseline is resolved from the working directory, like configFile, and must stay inside the Gate root. */
async function loadAcceptedMutants(canonicalRoot: string, workingDirectory: string, file: string): Promise<LoadedBaseline> {
  const lexical = confineCanonicalStrykerCwd(canonicalRoot, resolve(workingDirectory, file));
  if (lexical.kind === 'outside') return lexical;

  const canonical = await realpath(lexical.path).catch((error: Error) => error);
  if (canonical instanceof Error) return { kind: 'invalid', detail: canonical.message };
  const confined = confineCanonicalStrykerCwd(canonicalRoot, canonical);
  if (confined.kind === 'outside') return confined;

  const text = await readFile(confined.path, 'utf8').catch((error: Error) => error);
  const parsed = text instanceof Error ? text : parseAcceptedStrykerMutants(text);
  return parsed instanceof Error
    ? { kind: 'invalid', detail: parsed.message }
    : { kind: 'loaded', accepted: parsed };
}

function withCwd<T>(root: string, action: () => Promise<T>): Promise<T> {
  const before = process.cwd();
  const beforeExitCode = process.exitCode;
  process.chdir(root);

  return action().finally(() => {
    process.chdir(before);
    process.exitCode = beforeExitCode;
  });
}

// An inherited NODE_TEST_CONTEXT makes a `node --test` child exit 0 on failure.
function withoutTestRunnerEnv<T>(action: () => Promise<T>): Promise<T> {
  const before = process.env.NODE_TEST_CONTEXT;
  if (before === undefined) return action();

  delete process.env.NODE_TEST_CONTEXT;

  return action().finally(() => {
    process.env.NODE_TEST_CONTEXT = before;
  });
}

const BASELINE_INVALID_MESSAGES = {
  'stryker-accepted-mutants-stale': 'Accepted mutants are now detected. Remove them from the baseline.',
  'stryker-mutant-identity-unavailable': 'Stryker produced an undetected mutant without a stable identity.',
  'stryker-mutant-identity-ambiguous': 'Stryker reported two undetected mutants with one identity.',
} as const satisfies Record<Extract<StrykerBaselineAssessment, { kind: 'invalid' }>['code'], string>;

const STRYKER_RULE_NAMES = [
  'mutantsDetected',
  'noNewUndetectedMutants',
  'mutationScore',
] as const;

export function stryker<const O extends StrykerAdapterOptions<StrykerRuleOptions>>(
  options: O
    & NoUnknownKeys<O, StrykerAdapterOptions<StrykerRuleOptions>>
    & { readonly rules: NoUnknownKeys<O['rules'], StrykerRuleOptions> },
): Adapter<StrykerRuleCatalog<O['rules']>> {
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

  const rules = defineRules(catalog as StrykerRuleCatalog<O['rules']>);
  type Ref = RuleRefOfCatalog<StrykerRuleCatalog<O['rules']>>;
  const rulesByAlias = rules as unknown as Readonly<Record<string, Rule<Ref>>>;
  const cwd = options.cwd ?? '.';
  const configFile = options.configFile;

  return defineAdapter({
    kind: 'stryker',
    rules,
    check: {
      description: 'run Stryker mutation testing and evaluate undetected mutants and mutation score',
      counting: counting.supported,

      async run(ctx) {
        const startedAt = now();

        try {
          const lexicalWorkingDirectory = resolveStrykerCwd(ctx.root, cwd);
          if (lexicalWorkingDirectory.kind === 'outside') return cwdOutsideRoot(startedAt, lexicalWorkingDirectory.path);
          const canonicalRoot = await realpath(ctx.root);
          const workingDirectory = confineCanonicalStrykerCwd(canonicalRoot, await realpath(lexicalWorkingDirectory.path));
          if (workingDirectory.kind === 'outside') return cwdOutsideRoot(startedAt, workingDirectory.path);

          return await withCwd(workingDirectory.path, async () => withoutTestRunnerEnv(async () => {
            let acceptedMutants: readonly AcceptedStrykerMutant[] | undefined;
            let acceptedMutantsLocationFile: string | undefined;
            const acceptedMutantsFile = options.rules.noNewUndetectedMutants?.acceptedMutantsFile;
            if (acceptedMutantsFile) {
              const baselinePath = resolve(workingDirectory.path, acceptedMutantsFile);
              const loaded = await loadAcceptedMutants(canonicalRoot, workingDirectory.path, acceptedMutantsFile);
              if (loaded.kind === 'outside') {
                return refuseBeforeRun(startedAt, {
                  code: 'stryker-accepted-mutants-outside-root',
                  message: 'The accepted-mutants baseline resolves outside the Gate root.',
                  location: { file: acceptedMutantsFile, line: null, column: null },
                  detail: loaded.path,
                });
              }
              acceptedMutantsLocationFile = projectRelativeFile(canonicalRoot, baselinePath);
              if (loaded.kind === 'invalid') {
                return refuseBeforeRun(startedAt, {
                  code: 'stryker-accepted-mutants-invalid',
                  message: 'The accepted-mutants baseline could not be read.',
                  location: { file: acceptedMutantsLocationFile, line: null, column: null },
                  detail: loaded.detail,
                });
              }
              acceptedMutants = loaded.accepted;
            }

            // Stryker's generated type uses a nominal string enum for values
            // that its public configuration schema accepts as string literals.
            const engine = new Stryker(
              strykerProgrammaticOptions(configFile) as ConstructorParameters<typeof Stryker>[0],
            );
            const producerMutants = await engine.runMutationTest() as readonly StrykerMutantResult[];
            const mutants = relativizeStrykerMutants(
              canonicalRoot,
              workingDirectory.path,
              producerMutants,
            );
            const metrics = mutationMetrics(producerMutants);
            const scan = {
              source: 'stryker',
              startedAt,
              finishedAt: now(),
              inspected: producerMutants.length,
            } as const;

            if (metrics.pending > 0) {
              return result.refuse(scan, {
                code: 'stryker-incomplete',
                message: 'Stryker completed with pending mutants, so the mutation result is not trustworthy.',
                location: null,
                detail: `${metrics.pending} mutant(s) remained pending.`,
              });
            }

            if (options.rules.mutationScore && metrics.score === null) {
              return result.refuse(scan, {
                code: 'mutation-score-unavailable',
                message: 'Mutation score could not be calculated because Stryker produced no valid mutants.',
                location: null,
              });
            }

            const baseline = acceptedMutants
              ? assessStrykerBaseline(workingDirectory.path, producerMutants, acceptedMutants)
              : undefined;
            if (baseline?.kind === 'invalid') {
              return result.refuse(scan, {
                code: baseline.code,
                message: BASELINE_INVALID_MESSAGES[baseline.code],
                location: acceptedMutantsLocationFile
                  ? { file: acceptedMutantsLocationFile, line: null, column: null }
                  : null,
                detail: baseline.detail,
              });
            }

            const breaches: Breach<Ref>[] = [];

            if (options.rules.mutantsDetected) {
              breaches.push(...undetectedMutantBreaches(
                mutants,
                rulesByAlias.mutantsDetected!,
              ));
            }

            if (options.rules.noNewUndetectedMutants && baseline?.kind === 'compared') {
              breaches.push(...undetectedMutantBreaches(
                relativizeStrykerMutants(
                  canonicalRoot,
                  workingDirectory.path,
                  baseline.newUndetected,
                ),
                rulesByAlias.noNewUndetectedMutants!,
                'outside the accepted baseline',
              ));
            }

            if (options.rules.mutationScore) {
              const scoreBreach = mutationScoreBreach(
                metrics,
                options.rules.mutationScore.minimum,
                rulesByAlias.mutationScore!,
              );
              if (scoreBreach) breaches.push(scoreBreach);
            }

            return result.fromBreaches(scan, breaches);
          }));
        } catch (error) {
          return refuseBeforeRun(startedAt, {
            code: 'stryker-unavailable',
            message: 'Stryker could not complete the mutation check.',
            location: null,
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      },
    },
  });
}

export type { AcceptedStrykerMutant } from './baseline.ts';
export type { MutationMetrics, StrykerMutantResult, StrykerMutantStatus } from './model.ts';
