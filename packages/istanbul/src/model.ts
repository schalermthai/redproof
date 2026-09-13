import { isAbsolute, relative, resolve, sep } from 'node:path';
import { breach, type Breach, type Rule, type RuleRef } from 'redproof';

export const metrics = ['statements', 'branches', 'functions', 'lines'] as const;
export type Metric = typeof metrics[number];
export type Threshold = { readonly minimum: number; readonly perFile?: boolean };
export type CoverageRules = { readonly [K in Metric]?: Threshold };
export type CoverageCatalog<R extends CoverageRules> = { readonly [K in keyof R]: K extends Metric ? Rule<`istanbul/${K}-coverage`> : never };
type Count = { readonly total: number; readonly covered: number; readonly pct: number };
export type CoverageFile = { readonly file: string; readonly counts: Readonly<Record<Metric, Count>> };
export type CoverageEvidence = { readonly files: readonly CoverageFile[]; readonly total: Readonly<Record<Metric, Count>> };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an Istanbul object.');
  return value as Record<string, unknown>;
}
function integer(value: unknown, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) throw new Error('Invalid Istanbul count or position.');
  return value as number;
}
function location(value: unknown): { line: number; column: number } {
  const loc = object(value), start = object(loc.start), end = object(loc.end);
  const line = integer(start.line, 1), column = integer(start.column);
  const endLine = integer(end.line, 1), endColumn = integer(end.column);
  if (endLine < line || (endLine === line && endColumn < column)) throw new Error('Reversed Istanbul location.');
  return { line, column };
}
function sameKeys(map: Record<string, unknown>, hits: Record<string, unknown>): void {
  if (Object.keys(map).length !== Object.keys(hits).length || Object.keys(map).some(key => !Object.hasOwn(hits, key))) {
    throw new Error('Istanbul maps and hit counts disagree.');
  }
}
function branchLocation(value: unknown): void {
  const loc = object(value), start = object(loc.start), end = object(loc.end);
  // Native Istanbul represents implicit else arms with empty endpoints. c8's
  // remapper also emits -1 columns. Neither changes branch hit-count evidence;
  // we deliberately report file-level thresholds, not fabricated coordinates.
  if (!Object.keys(start).length && !Object.keys(end).length) return;
  const line = integer(start.line, 1), endLine = integer(end.line, 1);
  const column = integer(start.column, -1), endColumn = integer(end.column, -1);
  if (endLine < line || (endLine === line && column >= 0 && endColumn >= 0 && endColumn < column)) throw new Error('Reversed Istanbul branch location.');
}
function count(total: number, covered: number): Count {
  // Match Istanbul's two-decimal truncation and its empty-metric convention.
  return { total, covered, pct: total ? Math.floor((100_000 * covered / total) / 10) / 100 : 100 };
}
function summarize(hits: readonly number[]): Count {
  return count(hits.length, hits.filter(hit => hit > 0).length);
}
export function coveragePath(root: string, file: string): string {
  if (!file.trim() || file.includes('\0')) throw new Error('Invalid Istanbul file path.');
  const path = relative(root, resolve(root, file));
  if (!path || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)
    || (sep === '/' && /^[A-Za-z]:|\\/u.test(file))) throw new Error('Istanbul file is outside the Gate root.');
  return path.split(sep).join('/');
}

export function parseCoverage(text: string, root: string): CoverageEvidence {
  const map = object(JSON.parse(text));
  const files: CoverageFile[] = [];
  const seen = new Set<string>();
  for (const [key, value] of Object.entries(map)) {
    const data = object(value);
    if (typeof data.path !== 'string') throw new Error('Missing Istanbul file path; summary-only reports are not supported.');
    const file = coveragePath(root, data.path);
    if (coveragePath(root, key) !== file || seen.has(file)) throw new Error('Conflicting or duplicate Istanbul file identity.');
    seen.add(file);
    const statements = object(data.statementMap), functions = object(data.fnMap), branches = object(data.branchMap);
    const s = object(data.s), f = object(data.f), b = object(data.b);
    sameKeys(statements, s); sameKeys(functions, f); sameKeys(branches, b);
    const lines = new Map<number, number>();
    for (const [id, statement] of Object.entries(statements)) {
      const { line } = location(statement), hits = integer(s[id]);
      lines.set(line, Math.max(lines.get(line) ?? 0, hits));
    }
    for (const [id, fn] of Object.entries(functions)) {
      const item = object(fn);
      location(item.loc);
      // Remapped producers can omit declaration coordinates; validate them when supplied.
      if (item.decl !== undefined) location(item.decl);
      integer(f[id]);
    }
    const branchHits: number[] = [];
    for (const [id, branch] of Object.entries(branches)) {
      const item = object(branch), locations = item.locations, hits = b[id];
      if (!Array.isArray(locations) || !Array.isArray(hits) || locations.length !== hits.length || !hits.length) {
        throw new Error('Incomplete Istanbul branch arms.');
      }
      for (const loc of locations) branchLocation(loc);
      for (const hit of hits) branchHits.push(integer(hit));
    }
    files.push({ file, counts: {
      statements: summarize(Object.values(s).map(value => integer(value))),
      functions: summarize(Object.values(f).map(value => integer(value))),
      branches: summarize(branchHits), lines: summarize([...lines.values()]),
    } });
  }
  files.sort((a, b) => a.file.localeCompare(b.file));
  const total = Object.fromEntries(metrics.map(metric => [metric, count(
    files.reduce((sum, file) => sum + file.counts[metric].total, 0),
    files.reduce((sum, file) => sum + file.counts[metric].covered, 0),
  )])) as Record<Metric, Count>;
  return { files, total };
}

export function coverageBreaches<R extends RuleRef>(evidence: CoverageEvidence,
  selected: ReadonlyMap<Metric, { readonly rule: Rule<R>; readonly threshold: Threshold }>): readonly Breach<R>[] {
  return [...selected].flatMap(([metric, { rule, threshold }]) => {
    const targets = threshold.perFile ? evidence.files.map(file => ({ file: file.file, counts: file.counts }))
      : [{ file: null, counts: evidence.total }];
    return targets.filter(target => target.counts[metric].pct < threshold.minimum).map(target => {
      const actual = target.counts[metric];
      return breach(rule, { code: `${metric}-coverage-below-minimum`,
        message: `${metric} coverage ${actual.pct}% is below ${threshold.minimum}%${target.file ? ` for ${target.file}` : ' overall'}.`,
        location: target.file ? { file: target.file, line: null, column: null } : null,
        detail: `${actual.covered}/${actual.total} covered; ${actual.total - actual.covered} uncovered.` });
    });
  });
}
