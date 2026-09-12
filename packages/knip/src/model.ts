import { breach, type Breach, type Rule, type RuleRef } from 'redproof';

export const issueTypes = [
  'files', 'dependencies', 'devDependencies', 'optionalPeerDependencies',
  'unlisted', 'binaries', 'unresolved', 'exports', 'types', 'nsExports',
  'nsTypes', 'duplicates', 'enumMembers', 'namespaceMembers', 'catalog',
  'catalogReferences', 'cycles',
] as const;
export type KnipIssueType = typeof issueTypes[number];

export type KnipFinding = {
  readonly type: KnipIssueType;
  readonly file: string;
  readonly symbol: string;
  readonly line: number | null;
  readonly column: number | null;
  readonly symbols: readonly string[];
};

export type KnipEvidence = {
  readonly inspected: number;
  readonly enabled: Readonly<Record<KnipIssueType, boolean>>;
  readonly findings: readonly KnipFinding[];
  readonly hasConfigLoadErrors: boolean;
  readonly hasBlockingHints: boolean;
  readonly hintDetails: readonly string[];
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected a structured Knip object.');
  }
  return value as Record<string, unknown>;
}

function nonempty(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Expected non-empty Knip text.');
  return value;
}

function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('Expected a non-negative Knip count.');
  }
  return value;
}

function position(value: unknown): number | null {
  if (value === undefined) return null;
  const n = count(value);
  if (n === 0) throw new Error('Knip positions must be one-based.');
  return n;
}

export function parseKnipEvidence(text: string): KnipEvidence {
  const data = record(JSON.parse(text));
  if (data.version !== 1) throw new Error('Unsupported Knip evidence protocol.');
  const enabled = record(data.report);
  const counters = record(data.counters);
  const issues = record(data.issues);
  if (typeof data.hasConfigLoadErrors !== 'boolean') throw new Error('Missing Knip config-load status.');
  if (typeof data.hasBlockingHints !== 'boolean') throw new Error('Missing Knip hint status.');
  if (!Array.isArray(data.hintDetails)) throw new Error('Missing Knip hint details.');
  const hintDetails = data.hintDetails.map(nonempty);
  if (data.hasBlockingHints !== (hintDetails.length > 0)) throw new Error('Contradictory Knip hint status.');
  const findings: KnipFinding[] = [];
  for (const type of issueTypes) {
    if (typeof enabled[type] !== 'boolean') throw new Error(`Missing Knip category ${type}.`);
    const expected = count(counters[type]);
    const entries = issues[type];
    if (!Array.isArray(entries)) throw new Error(`Missing Knip findings for ${type}.`);
    if (entries.length !== expected) throw new Error(`Contradictory Knip ${type} count.`);
    if (!enabled[type] && expected > 0) throw new Error(`Disabled Knip ${type} has findings.`);
    for (const value of entries) {
      const issue = record(value);
      if (issue.type !== type) throw new Error('Knip finding category mismatch.');
      const file = nonempty(issue.file);
      if (file.startsWith('/') || /^[A-Za-z]:/u.test(file) || file.split(/[\\/]/u).includes('..')) {
        throw new Error('Knip finding path escapes the Gate root.');
      }
      if (issue.severity !== undefined && issue.severity !== 'warn' && issue.severity !== 'error') {
        throw new Error('Invalid Knip finding severity.');
      }
      let symbols: string[] = [];
      if (issue.symbols !== undefined) {
        if (!Array.isArray(issue.symbols)) throw new Error('Invalid Knip symbols.');
        symbols = issue.symbols.map(value => {
          const item = record(value);
          const symbol = nonempty(item.symbol);
          const line = position(item.line);
          const column = position(item.col);
          return `${symbol}${line === null ? '' : `:${line}${column === null ? '' : `:${column}`}`}`;
        });
      }
      if ((type === 'duplicates' || type === 'cycles') && symbols.length < 2) {
        throw new Error(`Incomplete Knip ${type} group.`);
      }
      const first = Array.isArray(issue.symbols) && issue.symbols.length ? record(issue.symbols[0]) : undefined;
      const parent = issue.parentSymbol === undefined ? undefined : nonempty(issue.parentSymbol);
      findings.push({ type, file, symbol: nonempty(issue.symbol),
        line: position(issue.line ?? first?.line), column: position(issue.col ?? first?.col),
        symbols: parent ? [`Namespace: ${parent}`, ...symbols] : symbols });
    }
  }
  return {
    inspected: count(counters.processed),
    enabled: enabled as Record<KnipIssueType, boolean>,
    findings,
    hasConfigLoadErrors: data.hasConfigLoadErrors,
    hasBlockingHints: data.hasBlockingHints,
    hintDetails,
  };
}

export function knipBreaches<R extends RuleRef>(
  findings: readonly KnipFinding[],
  selected: ReadonlyMap<KnipIssueType, Rule<R>>,
): readonly Breach<R>[] {
  return findings.flatMap(finding => {
    const rule = selected.get(finding.type);
    if (!rule) return [];
    return [breach(rule, {
      code: finding.type,
      message: `Knip ${finding.type}: ${finding.symbol}.`,
      location: { file: finding.file, line: finding.line, column: finding.column },
      ...(finding.symbols.length ? { detail: finding.symbols.join(' -> ') } : {}),
    })];
  });
}
