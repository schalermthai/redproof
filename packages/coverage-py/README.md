# @redproof/coverage-py

Redproof adapter for [coverage.py](https://coverage.readthedocs.io). It runs
`python -m coverage run` on your program, then `coverage json`, and evaluates
Rules on the format-3 report. Node-only runtime; coverage.py must be installed
in the interpreter you name.

```ts
import { coveragePy } from '@redproof/coverage-py';

coveragePy({
  python: '.venv/bin/python',            // default: python3
  args: ['-m', 'pytest'],                // everything after `coverage run`
  source: ['src'],                       // needed to see files that never ran
  rules: {
    lineCoverage: { minimum: 90 },       // coverage-py/line-coverage
    branchCoverage: { minimum: 80 },     // coverage-py/branch-coverage
    perFileMinimum: { minimum: 60 },     // coverage-py/per-file-minimum (metric: 'lines' | 'branches')
    noUncoveredFiles: {},                // coverage-py/no-uncovered-files
  },
});
```

- Line coverage is `covered_lines / num_statements` (coverage.py's
  `percent_statements_covered`), not the blended `percent_covered`.
- Branch rules need branch data. `branch` defaults to true; selecting a branch
  rule with `branch: false` throws at construction.
- A non-zero exit from the program or from `coverage json` REFUSES. Coverage
  data left behind by a failing run cannot explain the failure.
- `expectedFiles` REFUSES when a listed file is absent from the report.

Known blind spots (all found in battle testing, see `20-coveragepy/REDPROOF_COVERAGEPY_BATTLE_TEST.md`):

- coverage.py only lists files it was told about (`source`) or that ran. Unimported namespace-package files are invisible;
  list them in `expectedFiles` so their absence REFUSES.
- Auto-discovered project config (`.coveragerc`, `setup.cfg`, `tox.ini`, `pyproject.toml`) that `omit`s files, adds
  `exclude_lines`/`exclude_also` patterns, or restricts the report with `include` (`[run]` or `[report]`) shrinks the denominator without the report disagreeing with itself, so the adapter
  REFUSES (`coverage-py-config-excludes`). Name the file as `rcfile` to accept it. The default `# pragma: no cover` is fine.
- A report that measures zero statements REFUSES: nothing to cover would otherwise count as 100 % and pass every rule.
- Modules imported before tracing starts show as never executed, which trips `noUncoveredFiles`.
- Subprocesses are measured only with `patch = subprocess` in your rcfile.
- Ambient `COVERAGE_RCFILE`, `COVERAGE_FILE`, `COVERAGE_PROCESS_START` and `COVERAGE_DEBUG*` are scrubbed; pass `rcfile`.
  `PYTHONPATH`, `COVERAGE_CORE` and the interpreter you name are trusted, not hostile. Coverage starts without the current
  directory on `sys.path`, so a project's own `json.py` or `coverage.py` cannot shadow it.
- A project `fail_under` is ignored; Redproof's thresholds decide.
- Percentages are floored to two decimals (coverage.py rounds), so a failing number never rounds up into a pass.

License: Apache-2.0
