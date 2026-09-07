import { counting, result, type Breach, type Check, type CheckResult, type RuleRef } from 'redproof';

/**
 * A Check that reads inputs once, then reports findings against them.
 *
 * The shape below is the plumbing every self-hosted Check repeats: stamp the
 * scan window, count what was inspected, turn findings into breaches, and
 * REFUSE when the inputs cannot be read at all.
 */
export type Scanning<R extends RuleRef, T> = {
  readonly description: string;
  readonly source: string;
  /** Read everything the Check needs. A throw here becomes REFUSE. */
  readonly gather: (root: string) => Promise<T>;
  /** How many things the Check looked at. */
  readonly inspected: (input: T) => number;
  /** The findings. An empty list is a PASS. */
  readonly breaches: (input: T) => readonly Breach<R>[];
  /** Another Check to run first. Its REFUSE wins; its breaches are carried. */
  readonly delegate?: (root: string) => Promise<CheckResult<R>>;
  readonly whenUnavailable: {
    readonly code: string;
    readonly message: string;
  };
};

export function scanning<R extends RuleRef, T>(spec: Scanning<R, T>): Check<R> {
  return {
    description: spec.description,
    counting: counting.supported,

    async run(ctx) {
      const startedAt = new Date().toISOString();
      const scan = (inspected: number | null) => ({
        source: spec.source,
        startedAt,
        finishedAt: new Date().toISOString(),
        inspected,
      });

      const delegated = await spec.delegate?.(ctx.root);
      if (delegated?.verdict === 'refuse') return delegated;
      const carried = delegated?.verdict === 'fail' ? delegated.breaches : [];

      try {
        const input = await spec.gather(ctx.root);
        return result.fromBreaches(
          scan(spec.inspected(input)),
          [...carried, ...spec.breaches(input)],
        );
      } catch (error) {
        return result.refuse(scan(null), {
          code: spec.whenUnavailable.code,
          message: spec.whenUnavailable.message,
          location: null,
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}
