import type { Diagnostic } from './diagnostic.ts';
import type { RuleRef } from './rule.ts';

export type NonEmptyList<T> = readonly [T, ...T[]];

export type CountingCapability =
  | { readonly kind: 'supported' }
  | { readonly kind: 'unsupported'; readonly reason: string };

export type Scan = {
  readonly source: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly inspected: number | null;
};

export type CheckContext<R extends RuleRef = RuleRef> = {
  readonly root: string;
  readonly rules: readonly R[];
};

export type Breach<R extends RuleRef = RuleRef> = Diagnostic & {
  readonly rule: R;
};

export type PassResult = {
  readonly verdict: 'pass';
  readonly scan: Scan;
};

export type FailResult<R extends RuleRef = RuleRef> = {
  readonly verdict: 'fail';
  readonly scan: Scan;
  readonly breaches: NonEmptyList<Breach<R>>;
};

export type RefuseResult = {
  readonly verdict: 'refuse';
  readonly scan: Scan;
  readonly why: Diagnostic;
};

export type CheckResult<R extends RuleRef = RuleRef> =
  | PassResult
  | FailResult<R>
  | RefuseResult;

export type Check<R extends RuleRef = RuleRef> = {
  readonly description: string;
  readonly counting: CountingCapability;
  run(ctx: CheckContext<R>): Promise<CheckResult<R>>;
};
