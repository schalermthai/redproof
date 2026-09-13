import { istanbul, nyc } from '../src/index.ts';
function types() {
  const adapter = nyc({ command: 'node', rules: { branches: { minimum: 90, perFile: true } } });
  const id: 'istanbul/branches-coverage' = adapter.rules.branches.id;
  // @ts-expect-error Unselected metric has no Rule.
  void adapter.rules.lines;
  // @ts-expect-error Unknown top-level options are rejected.
  nyc({ command: 'node', rules: { lines: { minimum: 90 } }, mystery: true });
  // @ts-expect-error Unknown threshold options are rejected.
  nyc({ command: 'node', rules: { lines: { minimum: 90, mystery: true } } });
  // @ts-expect-error Unknown metrics are rejected.
  nyc({ command: 'node', rules: { magic: { minimum: 90 } } });
  // @ts-expect-error Generic producer needs a private-report-aware argument builder.
  istanbul({ command: 'node', args: [], rules: { lines: { minimum: 90 } } });
  return id;
}
void types;
