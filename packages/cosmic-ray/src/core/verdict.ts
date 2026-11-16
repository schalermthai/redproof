import {
  breach,
  result,
  type Breach,
  type CheckResult,
  type Rule,
  type Scan,
} from 'redproof';
import { moduleFileInsideRoot, type CosmicRayMutant } from './report.ts';

export type CosmicRayPolicies<R extends string> = {
  readonly mutantsDetected?: Rule<R>;
  readonly mutationScore?: { readonly rule: Rule<R>; readonly minimum: number };
};

export type CosmicRayRun<R extends string> = {
  readonly scan: Scan;
  /** Both directories are absolute and canonical. */
  readonly root: string;
  readonly cwd: string;
  readonly mutants: readonly CosmicRayMutant[];
  /** Whether a timed-out mutant counts as killed (`detected`) or refuses the run. */
  readonly timeouts: 'detected' | 'refuse';
  readonly policies: CosmicRayPolicies<R>;
};

export type CosmicRayMetrics = {
  readonly killed: number;
  readonly survived: number;
  /** killed / (killed + survived) as a percentage, or null when nothing was judged. */
  readonly score: number | null;
};

/**
 * `killed / valid * 100 < minimum`, decided in integers: in floats 29/50 at minimum 58 reads 57.99999999999999 and breaches.
 * The minimum is taken to six decimals, which keeps every product below 2^53 for any realistic mutant count.
 */
export function scoreBelowMinimum(killed: number, valid: number, minimum: number): boolean {
  return killed * 100 * 1_000_000 < Math.round(minimum * 1_000_000) * valid;
}

export function cosmicRayMetrics(mutants: readonly CosmicRayMutant[], timeoutsDetected = false): CosmicRayMetrics {
  const killed = mutants.filter(mutant => mutant.status === 'killed' || (timeoutsDetected && mutant.status === 'timeout')).length;
  const survived = mutants.filter(mutant => mutant.status === 'survived').length;
  const valid = killed + survived;
  return { killed, survived, score: valid === 0 ? null : (killed / valid) * 100 };
}

function describe(mutant: CosmicRayMutant): string {
  return `${mutant.modulePath}:${mutant.line} ${mutant.operator}${mutant.reason ? ` (${mutant.reason})` : ''}`;
}

/** Judge one completed cosmic-ray session. Anything short of a clean kill-or-survive verdict for every job refuses. */
export function decideCosmicRayRun<R extends string>(run: CosmicRayRun<R>): CheckResult<R> {
  const { scan, root, cwd, mutants, timeouts, policies } = run;

  if (mutants.length === 0) {
    return result.refuse(scan, {
      code: 'cosmic-ray-no-mutants',
      message: 'cosmic-ray produced no mutants, so there is nothing to judge.',
      location: null,
    });
  }

  const timedOut = mutants.filter(mutant => mutant.status === 'timeout');
  const unfinished = mutants.filter(mutant => mutant.status === 'pending' || mutant.status === 'invalid'
    || (timeouts === 'refuse' && mutant.status === 'timeout'));
  if (unfinished.length > 0) {
    const shown = unfinished.slice(0, 5).map(mutant => `${mutant.status}: ${describe(mutant)}`);
    return result.refuse(scan, {
      code: 'cosmic-ray-incomplete',
      message: 'cosmic-ray did not give every mutant a kill or survive verdict, so the mutation result is not trustworthy.',
      location: null,
      detail: `${unfinished.length} of ${mutants.length} mutant(s) unfinished, timed out or invalid.\n${shown.join('\n')}`,
    });
  }

  // A cosmic-ray `timeout` that is too short makes every mutant time out and look killed.
  if (timedOut.length * 2 > mutants.length) {
    return result.refuse(scan, {
      code: 'cosmic-ray-timeouts-excessive',
      message: 'More than half of the mutants timed out, so the cosmic-ray `timeout` is probably too short and the result is not trustworthy.',
      location: null,
      detail: `${timedOut.length} of ${mutants.length} mutant(s) timed out.\n${timedOut.slice(0, 5).map(describe).join('\n')}`,
    });
  }

  const metrics = cosmicRayMetrics(mutants, timeouts === 'detected');
  const breaches: Breach<R>[] = [];

  if (policies.mutantsDetected) {
    for (const mutant of mutants.filter(item => item.status === 'survived')) {
      const file = moduleFileInsideRoot(root, cwd, mutant.modulePath);
      if (file === null) {
        return result.refuse(scan, {
          code: 'cosmic-ray-module-outside-root',
          message: 'A mutated module resolves outside the Gate root.',
          location: null,
          detail: mutant.modulePath,
        });
      }
      breaches.push(breach(policies.mutantsDetected, {
        code: 'mutant-survived',
        message: 'cosmic-ray mutant survived the test suite.',
        location: { file, line: mutant.line, column: mutant.column + 1 },
        detail: [mutant.operator, mutant.diff?.split('\n').filter(row => /^[+-][^+-]/u.test(row)).join(' | ')]
          .filter(Boolean).join(' — '),
      }));
    }
  }

  const { mutationScore } = policies;
  if (mutationScore && metrics.score !== null && scoreBelowMinimum(metrics.killed, metrics.killed + metrics.survived, mutationScore.minimum)) {
    breaches.push(breach(mutationScore.rule, {
      code: 'mutation-score-below-minimum',
      message: 'Mutation score is below the required minimum.',
      location: null,
      comparison: {
        expected: `>= ${mutationScore.minimum.toFixed(2)}%`,
        actual: `${metrics.score.toFixed(2)}%`,
      },
      detail: `${metrics.killed} killed${timedOut.length > 0 && timeouts === 'detected' ? ` (including ${timedOut.length} timed out: ${timedOut.slice(0, 5).map(describe).join('; ')})` : ''}, ${metrics.survived} survived.`,
    }));
  }

  return result.fromBreaches(scan, breaches);
}
