/** Minimal format-3 coverage.py report builder for synthetic cases; real reports live in test/fixtures. */
export type FileSpec = { lines: [covered: number, missing: number]; branches?: [covered: number, missing: number] };
export function report(files: Record<string, FileSpec>, branch = true): string {
  const entries = Object.entries(files).map(([name, spec]) => {
    const [c, m] = spec.lines, [bc, bm] = spec.branches ?? [0, 0];
    const summary: Record<string, number> = { covered_lines: c, num_statements: c + m, missing_lines: m };
    if (branch) Object.assign(summary, { num_branches: bc + bm, covered_branches: bc, missing_branches: bm });
    return [name, { executed_lines: Array.from({ length: c }, (_, i) => i + 1), missing_lines: Array.from({ length: m }, (_, i) => c + i + 1),
      ...(branch ? { executed_branches: Array.from({ length: bc }, (_, i) => [i, i + 1]), missing_branches: Array.from({ length: bm }, (_, i) => [i, -1]) } : {}), summary }] as const;
  });
  const sum = (key: 'lines' | 'branches', i: 0 | 1) => Object.values(files).reduce((n, f) => n + ((key === 'lines' ? f.lines : f.branches ?? [0, 0])[i]), 0);
  const totals: Record<string, number> = { covered_lines: sum('lines', 0), num_statements: sum('lines', 0) + sum('lines', 1) };
  if (branch) Object.assign(totals, { num_branches: sum('branches', 0) + sum('branches', 1), covered_branches: sum('branches', 0) });
  return JSON.stringify({ meta: { format: 3, branch_coverage: branch }, files: Object.fromEntries(entries), totals });
}
