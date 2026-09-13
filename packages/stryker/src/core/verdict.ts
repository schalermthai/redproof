import {
  result,
  type Breach,
  type CheckResult,
  type Rule,
  type Scan,
} from 'redproof';
import {
  assessStrykerBaseline,
  type AcceptedStrykerMutant,
  type StrykerBaselineAssessment,
} from './baseline.ts';
import {
  mutationMetrics,
  mutationScoreBreach,
  undetectedMutantBreaches,
  type StrykerMutantResult,
} from './model.ts';
import { relativizeStrykerMutants } from './paths.ts';

/** Each selected policy with everything it needs to judge one run. */
export type StrykerPolicies<R extends string> = {
  readonly mutantsDetected?: Rule<R>;
  readonly noNewUndetectedMutants?: {
    readonly rule: Rule<R>;
    /** The baseline file relative to the Gate root. */
    readonly baselineFile: string;
    readonly accepted: readonly AcceptedStrykerMutant[];
  };
  readonly mutationScore?: {
    readonly rule: Rule<R>;
    readonly minimum: number;
  };
};

export type StrykerRun<R extends string> = {
  readonly scan: Scan;
  /** Both directories are absolute and canonical. */
  readonly canonicalRoot: string;
  readonly workingDirectory: string;
  readonly mutants: readonly StrykerMutantResult[];
  readonly policies: StrykerPolicies<R>;
};

const BASELINE_INVALID_MESSAGES = {
  'stryker-accepted-mutants-stale': 'Accepted mutants are now detected. Remove them from the baseline.',
  'stryker-mutant-identity-unavailable': 'Stryker produced an undetected mutant without a stable identity.',
  'stryker-mutant-identity-ambiguous': 'Stryker reported two undetected mutants with one identity.',
} as const satisfies Record<Extract<StrykerBaselineAssessment, { kind: 'invalid' }>['code'], string>;

export function refuseCwdOutsideRoot(scan: Scan, path: string): CheckResult<never> {
  return result.refuse(scan, {
    code: 'stryker-cwd-outside-root',
    message: 'The Stryker working directory resolves outside the Gate root.',
    location: null,
    detail: path,
  });
}

export function refuseBaselineOutsideRoot(scan: Scan, acceptedMutantsFile: string, path: string): CheckResult<never> {
  return result.refuse(scan, {
    code: 'stryker-accepted-mutants-outside-root',
    message: 'The accepted-mutants baseline resolves outside the Gate root.',
    location: { file: acceptedMutantsFile, line: null, column: null },
    detail: path,
  });
}

export function refuseBaselineInvalid(scan: Scan, baselineFile: string, detail: string): CheckResult<never> {
  return result.refuse(scan, {
    code: 'stryker-accepted-mutants-invalid',
    message: 'The accepted-mutants baseline could not be read.',
    location: { file: baselineFile, line: null, column: null },
    detail,
  });
}

export function refuseUnavailable(scan: Scan, error: unknown): CheckResult<never> {
  return result.refuse(scan, {
    code: 'stryker-unavailable',
    message: 'Stryker could not complete the mutation check.',
    location: null,
    detail: error instanceof Error ? error.message : String(error),
  });
}

/** Judge one completed mutation run against every selected policy. */
export function decideStrykerRun<R extends string>(run: StrykerRun<R>): CheckResult<R> {
  const { scan, canonicalRoot, workingDirectory, mutants, policies } = run;
  const metrics = mutationMetrics(mutants);

  if (metrics.pending > 0) {
    return result.refuse(scan, {
      code: 'stryker-incomplete',
      message: 'Stryker completed with pending mutants, so the mutation result is not trustworthy.',
      location: null,
      detail: `${metrics.pending} mutant(s) remained pending.`,
    });
  }

  if (policies.mutationScore && metrics.score === null) {
    return result.refuse(scan, {
      code: 'mutation-score-unavailable',
      message: 'Mutation score could not be calculated because Stryker produced no valid mutants.',
      location: null,
    });
  }

  const baseline = policies.noNewUndetectedMutants
    ? assessStrykerBaseline(workingDirectory, mutants, policies.noNewUndetectedMutants.accepted)
    : undefined;
  if (policies.noNewUndetectedMutants && baseline?.kind === 'invalid') {
    return result.refuse(scan, {
      code: baseline.code,
      message: BASELINE_INVALID_MESSAGES[baseline.code],
      location: { file: policies.noNewUndetectedMutants.baselineFile, line: null, column: null },
      detail: baseline.detail,
    });
  }

  const breaches: Breach<R>[] = [];

  if (policies.mutantsDetected) {
    breaches.push(...undetectedMutantBreaches(
      relativizeStrykerMutants(canonicalRoot, workingDirectory, mutants),
      policies.mutantsDetected,
    ));
  }

  if (policies.noNewUndetectedMutants && baseline?.kind === 'compared') {
    breaches.push(...undetectedMutantBreaches(
      relativizeStrykerMutants(canonicalRoot, workingDirectory, baseline.newUndetected),
      policies.noNewUndetectedMutants.rule,
      'outside the accepted baseline',
    ));
  }

  if (policies.mutationScore) {
    const scoreBreach = mutationScoreBreach(
      metrics,
      policies.mutationScore.minimum,
      policies.mutationScore.rule,
    );
    if (scoreBreach) breaches.push(scoreBreach);
  }

  return result.fromBreaches(scan, breaches);
}
