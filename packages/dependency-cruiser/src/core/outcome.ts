import {
  result,
  type CheckResult,
  type Diagnostic,
  type RefuseResult,
  type Rule,
  type RuleRef,
  type Scan,
} from 'redproof';
import {
  dependencyCruiserRuleAvailability,
  violationsToBreaches,
  type DependencyCruiserConfig,
  type DependencyCruiserViolation,
} from './model.ts';

export type Timestamps = {
  readonly startedAt: string;
  readonly finishedAt: string;
};

type PackageExport = string | {
  readonly import?: string;
  readonly default?: string;
};

export type PackageManifest = {
  readonly name?: string;
  readonly exports?: Readonly<Record<string, PackageExport>>;
};

export type CruiseOutputLike = {
  readonly summary?: {
    readonly totalCruised?: number;
    readonly violations?: readonly DependencyCruiserViolation[];
  };
};

export type KnownViolationsBaseline = readonly unknown[];

function scan(time: Timestamps, inspected: number | null): Scan {
  return {
    source: 'dependency-cruiser',
    startedAt: time.startedAt,
    finishedAt: time.finishedAt,
    inspected,
  };
}

function refuse(time: Timestamps, why: Diagnostic): RefuseResult {
  return result.refuse(scan(time, null), why);
}

export function parseSelfManifest(text: string | null): PackageManifest | null {
  if (text === null) return null;
  let manifest: PackageManifest;
  try {
    manifest = JSON.parse(text) as PackageManifest;
  } catch {
    return null;
  }
  return manifest?.name === 'dependency-cruiser' ? manifest : null;
}

export function selfExport(manifest: PackageManifest, subpath: string): string {
  const exported = manifest.exports?.[subpath];
  const target = typeof exported === 'string'
    ? exported
    : exported?.import ?? exported?.default;
  if (!target) {
    throw new Error(`dependency-cruiser does not export ${subpath}.`);
  }
  return target;
}

export function parseKnownViolations(path: string, text: string): KnownViolationsBaseline | Error {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return new Error(`${path} is not valid JSON. ${(error as Error).message}`);
  }

  if (!Array.isArray(parsed)) {
    return new Error(`${path} must hold a JSON array of known violations.`);
  }
  return parsed;
}

// dependency-cruiser returns a JSON string for outputType 'json'.
function readCruiseOutput(output: unknown): CruiseOutputLike | null {
  if (typeof output === 'string') {
    try {
      return JSON.parse(output) as CruiseOutputLike;
    } catch {
      return null;
    }
  }

  return typeof output === 'object' && output !== null
    ? output as CruiseOutputLike
    : null;
}

export function ruleAvailabilityRefusal(
  config: DependencyCruiserConfig,
  selected: readonly string[],
  configFile: string,
  time: Timestamps,
): RefuseResult | null {
  const availability = dependencyCruiserRuleAvailability(config, selected);

  if (availability.missing.length > 0) {
    return refuse(time, {
      code: 'dependency-cruiser-rule-missing',
      message: 'Configured Redproof rules are missing from the dependency-cruiser configuration.',
      location: { file: configFile, line: null, column: null },
      detail: `Missing: ${availability.missing.join(', ')}`,
    });
  }

  if (availability.inactive.length > 0) {
    return refuse(time, {
      code: 'dependency-cruiser-rule-inactive',
      message: 'Configured Redproof rules are disabled in the dependency-cruiser configuration.',
      location: { file: configFile, line: null, column: null },
      detail: `Inactive: ${availability.inactive.join(', ')}`,
    });
  }

  return null;
}

export function knownViolationsRefusal(
  baselineFile: string,
  error: Error,
  time: Timestamps,
): RefuseResult {
  return refuse(time, {
    code: 'dependency-cruiser-known-violations-invalid',
    message: 'The known-violations baseline could not be read.',
    location: { file: baselineFile, line: null, column: null },
    detail: error.message,
  });
}

export function cruiseVerdict<R extends RuleRef>(
  output: unknown,
  byForeignRule: ReadonlyMap<string, Rule<R>>,
  time: Timestamps,
): CheckResult<R> {
  const parsed = readCruiseOutput(output);
  if (!parsed?.summary || !Array.isArray(parsed.summary.violations)) {
    return refuse(time, {
      code: 'dependency-cruiser-output-unreadable',
      message: 'dependency-cruiser completed without a trustworthy structured result.',
      location: null,
    });
  }

  return result.fromBreaches(
    scan(time, parsed.summary.totalCruised ?? null),
    violationsToBreaches(parsed.summary.violations, byForeignRule),
  );
}

export function unavailableRefusal(error: unknown, time: Timestamps): RefuseResult {
  return refuse(time, {
    code: 'dependency-cruiser-unavailable',
    message: 'dependency-cruiser could not complete the check.',
    location: null,
    detail: error instanceof Error ? error.message : String(error),
  });
}
