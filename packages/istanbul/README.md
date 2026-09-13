# @redproof/istanbul

Turn fresh Istanbul coverage into independently provable Redproof Rules.
Requires Node 24. The `nyc()` wrapper supports installed nyc 15–18; the generic
`istanbul()` adapter accepts a full Istanbul JSON map from other producers.

```bash
npm install --save-dev redproof @redproof/istanbul nyc
```

```ts
import { nyc } from '@redproof/istanbul';
import { defineGate } from 'redproof';

const adapter = nyc({
  command: 'node',
  args: ['node_modules/mocha/bin/mocha', 'test/**/*.js'],
  include: ['src/**/*.js'],
  expectedFiles: ['src/orders.js'],
  rules: {
    statements: { minimum: 90 },
    branches: { minimum: 80, perFile: true },
    functions: { minimum: 90 },
    lines: { minimum: 90 },
  },
});

export default defineGate({ id: 'coverage', adapter });
```

| Selection | Rule ID |
|---|---|
| `statements` | `istanbul/statements-coverage` |
| `branches` | `istanbul/branches-coverage` |
| `functions` | `istanbul/functions-coverage` |
| `lines` | `istanbul/lines-coverage` |

Each metric takes `minimum` (0–100 inclusive) and optional `perFile` (default
false). Unselected metrics do not breach. Overall percentages combine counts,
not averages of file percentages. Line coverage uses the highest statement hit
count on each starting line; percentages truncate to two decimal places, matching
Istanbul. A metric with no entities is 100%, as in Istanbul. A report with no
files has zero inspections and remains subject to the Gate's `emptyEvidence`
policy. A reported empty file is not evidence that other files were scanned.

## Fresh evidence, not a saved report

Every check gives the producer a new private report location. `nyc()` also uses
a fresh raw-data directory, disables cache and native threshold enforcement,
and enables `all` by default to include unexecuted files in the configured scope.
Pass the test executable, not `npm test` when that script already wraps nyc.

`istanbul()` supports other report-producing commands:

For this example, install `c8` as a development dependency in the checked project.

```ts
import { istanbul } from '@redproof/istanbul';

const adapter = istanbul({
  command: 'node',
  args: ({ reportDirectory, tempDirectory }) => [
    'node_modules/c8/bin/c8.js', '--reporter=json',
    `--reports-dir=${reportDirectory}`, `--temp-directory=${tempDirectory}`,
    'node', '--test', 'test/orders.test.js',
  ],
  expectedFiles: ['src/orders.js'],
  rules: { branches: { minimum: 80 } },
});
```

The argument builder receives `root`, `cwd`, `reportFile`, `reportDirectory`,
and `tempDirectory`. The child also receives `REDPROOF_COVERAGE_REPORT`.
It must write full coverage-map JSON to `reportFile` (`coverage-final.json`),
not summary-only JSON. A custom producer must collect fresh raw coverage too;
copying an old report into a fresh filename is outside the adapter's trust.

## Options and verdicts

Common options: `cwd` (Gate-root-relative, default `.`), `expectedFiles`
(non-empty list of Gate-root-relative paths), `timeoutMs` (default 60 seconds),
`maxOutputBytes` (combined stdout/stderr, default 10 MiB), and `maxReportBytes`
(default 20 MiB). Explicit paths and reported source files must remain inside
the Gate root, including symlink targets. Sources must exist locally.

`nyc()` additionally accepts `configFile` (Gate-root-relative), native
`include`/`exclude` glob lists, `all` (default true), and a static `args` list.
Native config discovery applies unless `configFile` is supplied.

- PASS: a successful producer supplied valid coverage meeting selected thresholds.
- FAIL: valid evidence falls below a selected threshold. Per-file breaches name
  the file; overall breaches provide covered/total/uncovered counts.
- REFUSE: producer failure, timeout, signal, output limit, missing/malformed
  report, inconsistent maps/counts, unsafe paths, or missing expected files.

Failed tests can leave valid coverage. Any nonzero producer exit REFUSES rather
than pretending that report proves a complete successful run. Use the testing
adapter separately for detailed test-failure Rules.

Implicit `else` arms may lack coordinates; c8 may emit unknown branch columns.
These do not invalidate branch counts. Threshold diagnostics are file-level,
not assertions about exact uncovered source positions.

Ignore directives, exclusions, instrumentation, source-map correctness and
test discovery remain producer responsibilities. `expectedFiles` detects missing
files, not silently omitted statements within a file. Coverage measures execution,
not assertion quality or correctness; combine it with testing and mutation Gates.

The package owns its TCK and real nyc regressions. See the repository's
`docs/istanbul-expert-dogfood.md` for native experiments and their limitations.
