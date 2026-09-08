import {
  breach,
  type Breach,
  type Diagnostic,
  type Rule,
} from 'redproof';

export type StrykerMutantStatus =
  | 'Killed'
  | 'Survived'
  | 'NoCoverage'
  | 'CompileError'
  | 'RuntimeError'
  | 'Timeout'
  | 'Ignored'
  | 'Pending';

export type StrykerMutantResult = {
  readonly id: string;
  readonly status: StrykerMutantStatus;
  readonly fileName?: string;
  readonly mutatorName?: string;
  readonly replacement?: string;
  readonly description?: string;
  readonly statusReason?: string;
  readonly location?: {
    readonly start: {
      readonly line: number;
      readonly column: number;
    };
    readonly end?: {
      readonly line: number;
      readonly column: number;
    };
  };
};

export type MutationMetrics = {
  readonly detected: number;
  readonly undetected: number;
  readonly valid: number;
  readonly invalid: number;
  readonly ignored: number;
  readonly pending: number;
  readonly score: number | null;
};

export function mutationMetrics(mutants: readonly StrykerMutantResult[]): MutationMetrics {
  let detected = 0;
  let undetected = 0;
  let invalid = 0;
  let ignored = 0;
  let pending = 0;

  for (const mutant of mutants) {
    switch (mutant.status) {
      case 'Killed':
      case 'Timeout':
        detected += 1;
        break;
      case 'Survived':
      case 'NoCoverage':
        undetected += 1;
        break;
      case 'CompileError':
      case 'RuntimeError':
        invalid += 1;
        break;
      case 'Ignored':
        ignored += 1;
        break;
      case 'Pending':
        pending += 1;
        break;
    }
  }

  const valid = detected + undetected;
  return {
    detected,
    undetected,
    valid,
    invalid,
    ignored,
    pending,
    score: valid === 0 ? null : (detected / valid) * 100,
  };
}

function mutantDiagnostic(mutant: StrykerMutantResult, context?: string): Diagnostic {
  const status = mutant.status === 'NoCoverage' ? 'had no test coverage' : 'survived the test suite';
  const parts = [
    mutant.mutatorName,
    mutant.description ?? (mutant.replacement ? `replacement: ${mutant.replacement}` : undefined),
    mutant.statusReason,
  ].filter(Boolean);

  return {
    code: mutant.status === 'NoCoverage' ? 'mutant-no-coverage' : 'mutant-survived',
    message: `Stryker mutant ${status}${context ? `, ${context}` : ''}.`,
    location: mutant.fileName
      ? {
          file: mutant.fileName,
          line: mutant.location?.start.line ?? null,
          column: mutant.location?.start.column ?? null,
        }
      : null,
    ...(parts.length ? { detail: parts.join(' — ') } : {}),
  };
}

export function undetectedMutantBreaches<R extends string>(
  mutants: readonly StrykerMutantResult[],
  rule: Rule<R>,
  context?: string,
): readonly Breach<R>[] {
  return mutants
    .filter(mutant => mutant.status === 'Survived' || mutant.status === 'NoCoverage')
    .map(mutant => breach(rule, mutantDiagnostic(mutant, context)));
}

export function mutationScoreBreach<R extends string>(
  metrics: MutationMetrics,
  minimum: number,
  rule: Rule<R>,
): Breach<R> | null {
  if (metrics.score === null || metrics.score >= minimum) return null;

  return breach(rule, {
    code: 'mutation-score-below-minimum',
    message: 'Mutation score is below the required minimum.',
    location: null,
    comparison: {
      expected: `>= ${minimum.toFixed(2)}%`,
      actual: `${metrics.score.toFixed(2)}%`,
    },
    detail: `${metrics.detected} detected, ${metrics.undetected} undetected, ${metrics.valid} valid mutants.`,
  });
}
