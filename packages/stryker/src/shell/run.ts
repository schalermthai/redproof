import { Stryker } from '@stryker-mutator/core';
import { readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { CheckContext, CheckResult, Scan } from 'redproof';
import { parseAcceptedStrykerMutants, type AcceptedStrykerMutant } from '../core/baseline.ts';
import {
  strykerProgrammaticOptions,
  type RunMutationTest,
  type StrykerMutantResult,
} from '../core/model.ts';
import type { StrykerRunPlan } from '../core/options.ts';
import {
  confineCanonicalStrykerCwd,
  projectRelativeFile,
  resolveStrykerCwd,
} from '../core/paths.ts';
import {
  decideStrykerRun,
  refuseBaselineInvalid,
  refuseBaselineOutsideRoot,
  refuseCwdOutsideRoot,
  refuseUnavailable,
  type StrykerPolicies,
} from '../core/verdict.ts';

// Stryker's generated type uses a nominal string enum for values
// that its public configuration schema accepts as string literals.
export const runStrykerEngine: RunMutationTest = async options => {
  const engine = new Stryker(options as ConstructorParameters<typeof Stryker>[0]);
  return await engine.runMutationTest() as readonly StrykerMutantResult[];
};

function now(): string {
  return new Date().toISOString();
}

function scan(startedAt: string, inspected: number | null): Scan {
  return { source: 'stryker', startedAt, finishedAt: now(), inspected };
}

type LoadedBaseline =
  | { readonly kind: 'loaded'; readonly file: string; readonly accepted: readonly AcceptedStrykerMutant[] }
  | { readonly kind: 'outside'; readonly path: string }
  | { readonly kind: 'invalid'; readonly file: string; readonly detail: string };

/** The baseline is resolved from the working directory, like configFile, and must stay inside the Gate root. */
async function loadAcceptedMutants(
  canonicalRoot: string,
  workingDirectory: string,
  acceptedMutantsFile: string,
): Promise<LoadedBaseline> {
  const lexical = confineCanonicalStrykerCwd(canonicalRoot, resolve(workingDirectory, acceptedMutantsFile));
  if (lexical.kind === 'outside') return lexical;
  const file = projectRelativeFile(canonicalRoot, lexical.path);

  const canonical = await realpath(lexical.path).catch((error: Error) => error);
  if (canonical instanceof Error) return { kind: 'invalid', file, detail: canonical.message };
  const confined = confineCanonicalStrykerCwd(canonicalRoot, canonical);
  if (confined.kind === 'outside') return confined;

  const text = await readFile(confined.path, 'utf8').catch((error: Error) => error);
  const parsed = text instanceof Error ? text : parseAcceptedStrykerMutants(text);
  return parsed instanceof Error
    ? { kind: 'invalid', file, detail: parsed.message }
    : { kind: 'loaded', file, accepted: parsed };
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

export async function runStrykerCheck<R extends string>(
  ctx: CheckContext<R>,
  plan: StrykerRunPlan<R>,
  runMutationTest: RunMutationTest,
): Promise<CheckResult<R>> {
  const startedAt = now();

  try {
    const lexicalWorkingDirectory = resolveStrykerCwd(resolve(ctx.root), plan.cwd);
    if (lexicalWorkingDirectory.kind === 'outside') {
      return refuseCwdOutsideRoot(scan(startedAt, null), lexicalWorkingDirectory.path);
    }
    const canonicalRoot = await realpath(ctx.root);
    const workingDirectory = confineCanonicalStrykerCwd(canonicalRoot, await realpath(lexicalWorkingDirectory.path));
    if (workingDirectory.kind === 'outside') {
      return refuseCwdOutsideRoot(scan(startedAt, null), workingDirectory.path);
    }

    return await withCwd(workingDirectory.path, async () => withoutTestRunnerEnv(async () => {
      const baseline = plan.noNewUndetectedMutants
        ? await loadAcceptedMutants(canonicalRoot, workingDirectory.path, plan.noNewUndetectedMutants.acceptedMutantsFile)
        : undefined;
      if (plan.noNewUndetectedMutants && baseline?.kind === 'outside') {
        return refuseBaselineOutsideRoot(scan(startedAt, null), plan.noNewUndetectedMutants.acceptedMutantsFile, baseline.path);
      }
      if (baseline?.kind === 'invalid') {
        return refuseBaselineInvalid(scan(startedAt, null), baseline.file, baseline.detail);
      }
      const policies: StrykerPolicies<R> = {
        ...(plan.mutantsDetected ? { mutantsDetected: plan.mutantsDetected } : {}),
        ...(plan.mutationScore ? { mutationScore: plan.mutationScore } : {}),
        ...(plan.noNewUndetectedMutants && baseline?.kind === 'loaded'
          ? {
              noNewUndetectedMutants: {
                rule: plan.noNewUndetectedMutants.rule,
                baselineFile: baseline.file,
                accepted: baseline.accepted,
              },
            }
          : {}),
      };

      const mutants = await runMutationTest(strykerProgrammaticOptions(plan.configFile));
      return decideStrykerRun({
        scan: scan(startedAt, mutants.length),
        canonicalRoot,
        workingDirectory: workingDirectory.path,
        mutants,
        policies,
      });
    }));
  } catch (error) {
    return refuseUnavailable(scan(startedAt, null), error);
  }
}
