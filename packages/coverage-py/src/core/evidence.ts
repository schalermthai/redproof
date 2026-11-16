import { isAbsolute } from 'node:path';
import { coveragePath } from './paths.ts';
import type { Count } from './thresholds.ts';

export type CoverageFile = { readonly file: string; readonly lines: Count; readonly branches: Count };
export type CoverageEvidence = { readonly branch: boolean; readonly files: readonly CoverageFile[]; readonly lines: Count; readonly branches: Count };

function object(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Expected a coverage.py ${what} object.`);
  return value as Record<string, unknown>;
}
function integer(value: unknown, what: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`Invalid coverage.py ${what}.`);
  return value as number;
}
function length(value: unknown, what: string): number {
  if (!Array.isArray(value)) throw new Error(`Missing coverage.py ${what}.`);
  return value.length;
}
function sum(files: readonly CoverageFile[], key: 'lines' | 'branches'): Count {
  return { total: files.reduce((n, f) => n + f[key].total, 0), covered: files.reduce((n, f) => n + f[key].covered, 0) };
}

/** Parse a format-3 `coverage json` report, trusting nothing: summaries must agree with line/branch lists and totals with files. */
export function parseCoveragePy(text: string, root: string, cwd: string): CoverageEvidence {
  // path.resolve/relative consult process.cwd() for relative inputs; the shell must hand over absolute, real paths.
  if (!isAbsolute(root) || !isAbsolute(cwd)) throw new Error('root and cwd must be absolute paths.');
  const report = object(JSON.parse(text), 'report'), meta = object(report.meta, 'meta');
  if (meta.format !== 3) throw new Error(`Unsupported coverage.py JSON format ${String(meta.format)}; expected 3.`);
  if (typeof meta.branch_coverage !== 'boolean') throw new Error('Missing coverage.py meta.branch_coverage.');
  const branch = meta.branch_coverage;
  const files: CoverageFile[] = [], seen = new Set<string>();
  for (const [key, value] of Object.entries(object(report.files, 'files'))) {
    const data = object(value, 'file'), summary = object(data.summary, 'summary');
    const file = coveragePath(root, cwd, key);
    if (seen.has(file)) throw new Error('Duplicate coverage.py file identity.');
    seen.add(file);
    const lines = { total: integer(summary.num_statements, 'num_statements'), covered: integer(summary.covered_lines, 'covered_lines') };
    // The per-line lists are the evidence; the summary must agree with them or the report is not trustworthy.
    if (length(data.executed_lines, 'executed_lines') !== lines.covered || length(data.missing_lines, 'missing_lines') !== lines.total - lines.covered) {
      throw new Error(`coverage.py summary disagrees with line lists for ${file}.`);
    }
    let branches: Count = { total: 0, covered: 0 };
    if (branch) {
      branches = { total: integer(summary.num_branches, 'num_branches'), covered: integer(summary.covered_branches, 'covered_branches') };
      if (length(data.executed_branches, 'executed_branches') !== branches.covered
        || length(data.missing_branches, 'missing_branches') !== branches.total - branches.covered) {
        throw new Error(`coverage.py summary disagrees with branch lists for ${file}.`);
      }
    }
    files.push({ file, lines, branches });
  }
  files.sort((a, b) => a.file.localeCompare(b.file));
  const evidence = { branch, files, lines: sum(files, 'lines'), branches: sum(files, 'branches') };
  const totals = object(report.totals, 'totals');
  if (totals.num_statements !== evidence.lines.total || totals.covered_lines !== evidence.lines.covered
    || (branch && (totals.num_branches !== evidence.branches.total || totals.covered_branches !== evidence.branches.covered))) {
    throw new Error('coverage.py totals disagree with per-file data.');
  }
  return { ...evidence };
}
