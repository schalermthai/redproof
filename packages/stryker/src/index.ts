import { Stryker } from '@stryker-mutator/core';
import { readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  counting,
  defineAdapter,
  defineRules,
  result,
  type Adapter,
  type Breach,
  rejectUnknownKeys,
  type NoUnknownKeys,
  type Rule,
  type RuleCatalog,
  type RuleRefOfCatalog,
} from 'redproof';
import {
  assessStrykerBaseline,
  parseAcceptedStrykerMutants,
  type AcceptedStrykerMutant,
} from './baseline.ts';
import {
  mutationMetrics,
  mutationScoreBreach,
  undetectedMutantBreaches,
  type StrykerMutantResult,
} from './model.ts';
import { confineCanonicalStrykerCwd, resolveStrykerCwd } from './cwd.ts';

export type StrykerRuleOptions = {
  readonly mutantsDetected?: true;
  readonly noNewUndetectedMutants?: {
    /** JSON baseline path relative to the Gate root. */
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

const STRYKER_RULE_NAMES = [
  'mutantsDetected',
  'noNewUndetectedMutants',
  'mutationScore',
] as const;

export function stryker<const O extends StrykerRuleOptions>(
  options: StrykerAdapterOptions<O> & { readonly rules: NoUnknownKeys<O, StrykerRuleOptions> },
): Adapter<StrykerRuleCatalog<O>> {
  rejectUnknownKeys(options.rules, STRYKER_RULE_NAMES, 'Stryker rule');

  if (!options.rules.mutantsDetected
    && !options.rules.noNewUndetectedMutants
    && !options.rules.mutationScore) {
    throw new Error('Stryker adapter requires at least one Redproof rule.');
  }

  if (options.rules.mutationScore) {
    const minimum = options.rules.mutationScore.minimum;
    if (!Number.isFinite(minimum) || minimum < 0 || minimum > 100) {
      throw new Error('Stryker mutationScore.minimum must be between 0 and 100.');
    }
  }
  if (options.rules.noNewUndetectedMutants) {
    const baselineFile = options.rules.noNewUndetectedMutants.acceptedMutantsFile;
    if (typeof baselineFile !== 'string' || baselineFile.trim() === '') {
      throw new Error('Stryker noNewUndetectedMutants.acceptedMutantsFile must be a non-empty string.');
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

  const rules = defineRules(catalog as StrykerRuleCatalog<O>);
  type Ref = RuleRefOfCatalog<StrykerRuleCatalog<O>>;
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
          const workingDirectory = lexicalWorkingDirectory.kind === 'inside'
            ? confineCanonicalStrykerCwd(
              await realpath(ctx.root),
              await realpath(lexicalWorkingDirectory.path),
            )
            : lexicalWorkingDirectory;
          if (workingDirectory.kind === 'outside') {
            return result.refuse(
              {
                source: 'stryker',
                startedAt,
                finishedAt: now(),
                inspected: null,
              },
              {
                code: 'stryker-cwd-outside-root',
                message: 'The Stryker working directory resolves outside the Gate root.',
                location: null,
                detail: workingDirectory.path,
              },
            );
          }

          return await withCwd(workingDirectory.path, async () => withoutTestRunnerEnv(async () => {
            let acceptedMutants: readonly AcceptedStrykerMutant[] | undefined;
            const acceptedMutantsFile = options.rules.noNewUndetectedMutants?.acceptedMutantsFile;
            if (acceptedMutantsFile) {
              const baselinePath = resolve(ctx.root, acceptedMutantsFile);
              const baselineText = await readFile(baselinePath, 'utf8').catch(
                (error: NodeJS.ErrnoException) => error,
              );
              const loaded = baselineText instanceof Error
                ? baselineText
                : parseAcceptedStrykerMutants(baselineText);
              if (loaded instanceof Error) {
                return result.refuse(
                  {
                    source: 'stryker',
                    startedAt,
                    finishedAt: now(),
                    inspected: null,
                  },
                  {
                    code: 'stryker-accepted-mutants-invalid',
                    message: 'The accepted-mutants baseline could not be read.',
                    location: { file: acceptedMutantsFile, line: null, column: null },
                    detail: loaded.message,
                  },
                );
              }
              acceptedMutants = loaded;
            }

            const engine = new Stryker({
              ...(configFile ? { configFile } : {}),
              reporters: [],
            });
            const mutants = await engine.runMutationTest() as readonly StrykerMutantResult[];
            const metrics = mutationMetrics(mutants);
            const scan = {
              source: 'stryker',
              startedAt,
              finishedAt: now(),
              inspected: mutants.length,
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
              ? assessStrykerBaseline(process.cwd(), mutants, acceptedMutants)
              : undefined;
            if (baseline?.kind === 'invalid') {
              return result.refuse(scan, {
                code: baseline.code,
                message: baseline.code === 'stryker-accepted-mutants-stale'
                  ? 'The accepted-mutants baseline is stale.'
                  : 'Stryker produced an undetected mutant without a stable identity.',
                location: acceptedMutantsFile
                  ? { file: acceptedMutantsFile, line: null, column: null }
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
                baseline.newUndetected,
                rulesByAlias.noNewUndetectedMutants!,
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
          return result.refuse(
            {
              source: 'stryker',
              startedAt,
              finishedAt: now(),
              inspected: null,
            },
            {
              code: 'stryker-unavailable',
              message: 'Stryker could not complete the mutation check.',
              location: null,
              detail: error instanceof Error ? error.message : String(error),
            },
          );
        }
      },
    },
  });
}

export type { AcceptedStrykerMutant } from './baseline.ts';
export type { MutationMetrics, StrykerMutantResult, StrykerMutantStatus } from './model.ts';
