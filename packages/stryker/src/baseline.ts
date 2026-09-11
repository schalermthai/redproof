import {
  isAbsolute,
  posix,
  relative,
  resolve,
  sep,
} from 'node:path';
import type { StrykerMutantResult } from './model.ts';

type Position = {
  readonly line: number;
  readonly column: number;
};

export type AcceptedStrykerMutant = {
  readonly fileName: string;
  readonly mutatorName: string;
  readonly replacement: string;
  readonly location: {
    readonly start: Position;
    readonly end: Position;
  };
  readonly reason?: string;
};

export type StrykerBaselineAssessment =
  | {
      readonly kind: 'compared';
      readonly newUndetected: readonly StrykerMutantResult[];
    }
  | {
      readonly kind: 'invalid';
      readonly code:
        | 'stryker-mutant-identity-unavailable'
        | 'stryker-mutant-identity-ambiguous'
        | 'stryker-accepted-mutants-stale';
      readonly detail: string;
    };

/** Make producer paths stable and meaningful after a Redproof Gate copy is released. */
export function relativizeStrykerMutants(
  gateRoot: string,
  workingDirectory: string,
  mutants: readonly StrykerMutantResult[],
): readonly StrykerMutantResult[] {
  const absoluteGateRoot = resolve(gateRoot);
  const absoluteWorkingDirectory = resolve(workingDirectory);

  return mutants.map((mutant) => {
    if (!mutant.fileName) return mutant;
    const absoluteFile = isAbsolute(mutant.fileName)
      ? resolve(mutant.fileName)
      : resolve(absoluteWorkingDirectory, mutant.fileName);
    const relativeFile = relative(absoluteGateRoot, absoluteFile);
    if (relativeFile === '' || relativeFile === '..'
      || relativeFile.startsWith(`..${sep}`) || isAbsolute(relativeFile)) {
      return mutant;
    }
    return { ...mutant, fileName: relativeFile.split(sep).join('/') };
  });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function position(value: unknown): Position | null {
  if (!isRecord(value)) return null;
  const { line, column } = value;
  return Number.isInteger(line) && Number.isInteger(column)
    && (line as number) >= 1 && (column as number) >= 1
    ? { line: line as number, column: column as number }
    : null;
}

function normalizedBaselineFileName(fileName: string): string | null {
  const portable = fileName.replaceAll('\\', '/');
  if (portable === '' || portable.startsWith('/') || /^[A-Za-z]:\//u.test(portable)) {
    return null;
  }

  const normalized = posix.normalize(portable);
  return normalized === '.' || normalized === '..' || normalized.startsWith('../')
    ? null
    : normalized;
}

function parseEntry(value: unknown, index: number): AcceptedStrykerMutant | Error {
  if (!isRecord(value)) {
    return new Error(`Accepted mutant ${index + 1} must be a JSON object.`);
  }

  const fileName = typeof value.fileName === 'string'
    ? normalizedBaselineFileName(value.fileName)
    : null;
  if (!fileName) {
    return new Error(`Accepted mutant ${index + 1} must have a relative fileName inside the working directory.`);
  }
  if (typeof value.mutatorName !== 'string' || value.mutatorName === '') {
    return new Error(`Accepted mutant ${index + 1} must have a non-empty mutatorName.`);
  }
  if (typeof value.replacement !== 'string') {
    return new Error(`Accepted mutant ${index + 1} must have a string replacement.`);
  }
  if (!isRecord(value.location)) {
    return new Error(`Accepted mutant ${index + 1} must have a location.`);
  }

  const start = position(value.location.start);
  const end = position(value.location.end);
  if (!start || !end) {
    return new Error(`Accepted mutant ${index + 1} must have one-based start and end positions.`);
  }
  if (end.line < start.line || (end.line === start.line && end.column < start.column)) {
    return new Error(`Accepted mutant ${index + 1} ends before it starts.`);
  }
  if (value.reason !== undefined && (typeof value.reason !== 'string' || value.reason.trim() === '')) {
    return new Error(`Accepted mutant ${index + 1} reason must be a non-empty string when provided.`);
  }

  return {
    fileName,
    mutatorName: value.mutatorName,
    replacement: value.replacement,
    location: { start, end },
    ...(typeof value.reason === 'string' ? { reason: value.reason } : {}),
  };
}

/** Parse the checked-in, reviewable list of intentionally accepted mutants. */
export function parseAcceptedStrykerMutants(
  text: string,
): readonly AcceptedStrykerMutant[] | Error {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return new Error(`The accepted-mutants baseline is not valid JSON. ${(error as Error).message}`);
  }
  if (!Array.isArray(parsed)) {
    return new Error('The accepted-mutants baseline must be a JSON array.');
  }

  const accepted: AcceptedStrykerMutant[] = [];
  const identities = new Set<string>();
  for (const [index, value] of parsed.entries()) {
    const entry = parseEntry(value, index);
    if (entry instanceof Error) return entry;
    const identity = strykerMutantIdentity(entry);
    if (identities.has(identity)) {
      return new Error(`Accepted mutant ${index + 1} duplicates ${identity}.`);
    }
    identities.add(identity);
    accepted.push(entry);
  }
  return accepted;
}

/** Match Stryker's own cross-report mutant identity ingredients. */
export function strykerMutantIdentity(mutant: AcceptedStrykerMutant): string {
  const { start, end } = mutant.location;
  return `${mutant.fileName}@${start.line}:${start.column}-${end.line}:${end.column}`
    + `\n${mutant.mutatorName}: ${mutant.replacement}`;
}

function currentIdentity(
  workingDirectory: string,
  mutant: StrykerMutantResult,
): { readonly entry: AcceptedStrykerMutant; readonly mutant: StrykerMutantResult } | Error {
  if (!mutant.fileName || !mutant.mutatorName || mutant.replacement === undefined
    || !mutant.location?.end) {
    return new Error(`Stryker mutant ${mutant.id} is missing stable identity fields.`);
  }

  const absoluteRoot = resolve(workingDirectory);
  const absoluteFile = isAbsolute(mutant.fileName)
    ? resolve(mutant.fileName)
    : resolve(absoluteRoot, mutant.fileName);
  const relativeFile = relative(absoluteRoot, absoluteFile);
  if (relativeFile === '' || relativeFile === '..'
    || relativeFile.startsWith(`..${sep}`) || isAbsolute(relativeFile)) {
    return new Error(`Stryker mutant ${mutant.id} points outside the working directory: ${mutant.fileName}.`);
  }

  const fileName = relativeFile.split(sep).join('/');
  const entry = {
    fileName,
    mutatorName: mutant.mutatorName,
    replacement: mutant.replacement,
    location: {
      start: mutant.location.start,
      end: mutant.location.end,
    },
  };
  return {
    entry,
    mutant: { ...mutant, fileName },
  };
}

/** Compare current undetected mutants with an exact, identity-based baseline. File names are relative to the Stryker working directory. */
export function assessStrykerBaseline(
  workingDirectory: string,
  mutants: readonly StrykerMutantResult[],
  accepted: readonly AcceptedStrykerMutant[],
): StrykerBaselineAssessment {
  const current = new Map<string, StrykerMutantResult>();
  for (const mutant of mutants) {
    if (mutant.status !== 'Survived' && mutant.status !== 'NoCoverage') continue;
    const identified = currentIdentity(workingDirectory, mutant);
    if (identified instanceof Error) {
      return {
        kind: 'invalid',
        code: 'stryker-mutant-identity-unavailable',
        detail: identified.message,
      };
    }
    const identity = strykerMutantIdentity(identified.entry);
    if (current.has(identity)) {
      return {
        kind: 'invalid',
        code: 'stryker-mutant-identity-ambiguous',
        detail: `Stryker reported more than one undetected mutant as ${identity}.`,
      };
    }
    current.set(identity, identified.mutant);
  }

  const acceptedIdentities = new Set(accepted.map(strykerMutantIdentity));
  const newUndetected = [...current]
    .filter(([identity]) => !acceptedIdentities.has(identity))
    .map(([, mutant]) => mutant);
  if (newUndetected.length > 0) {
    return { kind: 'compared', newUndetected };
  }

  const stale = accepted
    .map(strykerMutantIdentity)
    .filter(identity => !current.has(identity));
  if (stale.length > 0) {
    return {
      kind: 'invalid',
      code: 'stryker-accepted-mutants-stale',
      detail: `${stale.length} accepted mutant(s) are no longer undetected: ${stale.join('; ')}`,
    };
  }

  return { kind: 'compared', newUndetected: [] };
}
