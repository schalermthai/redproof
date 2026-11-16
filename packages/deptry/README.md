# @redproof/deptry

Redproof adapter for [deptry](https://github.com/fpgmaas/deptry): find missing, unused, transitive, misplaced and standard-library dependencies in a Python project. Node-only: the adapter runs `deptry` as a subprocess and reads its `--json-output` report.

```ts
import { defineGate } from 'redproof';
import { deptry } from '@redproof/deptry';

export default defineGate({
  id: 'python-dependencies',
  adapter: deptry({
    command: '.venv/bin/deptry', // deptry must run in the project's own virtualenv
    rules: { missing: 'DEP001', unused: 'DEP002', transitive: 'DEP003', misplaced: 'DEP004', stdlib: 'DEP005' },
  }),
});
```

## Rules

Each entry of `rules` maps your alias to one deptry code and becomes the Redproof rule `deptry/<code>`. Any finding of a selected code fails that rule.

| Rule | deptry finds |
|---|---|
| `deptry/DEP001` | an imported module that is not a declared dependency |
| `deptry/DEP002` | a declared dependency that is never imported |
| `deptry/DEP003` | an import that relies on a transitive dependency |
| `deptry/DEP004` | a development dependency imported by production code |
| `deptry/DEP005` | a standard library module declared as a dependency |

An unknown code, or the same code twice, throws when the adapter is constructed.

## Options

| Option | Meaning |
|---|---|
| `rules` | alias to code, at least one |
| `paths` | directories to scan, relative to `cwd` (default `.`) |
| `cwd` | working directory relative to the Gate root: where deptry reads `pyproject.toml` / requirements files |
| `configFile` | a pyproject file relative to the Gate root (`--config`) |
| `ignoreNotebooks` | `--ignore-notebooks` |
| `allowPerRuleIgnores` | accept `per_rule_ignores` from the project configuration (see below) |
| `command`, `timeoutMs`, `maxOutputBytes` | the executable, a time limit (default 60 s), an output cap (default 10 MiB) |

The check always passes `--ignore ''`, so a project `ignore = [...]` list cannot silence a rule you selected, and `--verbose`, because deptry echoes its resolved configuration there and the adapter checks it.

## When the check REFUSES instead of passing

deptry exits 0 in several situations where nothing was really checked, and exits 1 both for findings and for a crash. The adapter refuses (with the code below) rather than pass or fail on such a run:

| Code | Cause |
|---|---|
| `deptry-input-skipped` | a file could not be parsed (`Skipping processing of ...`) or a requirement could not be read |
| `deptry-nothing-inspected` / `deptry-scan-unreadable` | zero files scanned, or no scan line |
| `deptry-report-unavailable` | no report written: a crash, a missing or malformed `pyproject.toml`, no dependency specification |
| `deptry-per-rule-ignores` | the project sets `per_rule_ignores`, which deptry cannot be told to disregard (set `allowPerRuleIgnores` to accept) |
| `deptry-ignore-active`, `deptry-config-unreadable` | the resolved configuration is missing or still has an ignore list |
| `deptry-report-inconsistent`, `deptry-report-invalid` | exit code and report disagree, or the report is not the expected JSON |
| `deptry-usage-error`, `deptry-unsuccessful` | exit 2, or any other unexpected exit |
| `deptry-version-unknown` / `deptry-version-unsupported` | not deptry, or older than 0.16.2 (the oldest release verified) |
| `deptry-path-*` | a named path or config file is missing or outside the Gate root |
| `command-*` | the executable is missing, timed out, or its output passed the cap |

## Blind spots

- `# deptry: ignore[...]` comments in source are honoured (deptry offers no way to turn them off).
- deptry's own `exclude` / `extend_exclude` and `.gitignore` decide which files are scanned; `tests` is excluded by default.
- DEP001, DEP003 and DEP004 depend on the package metadata installed in the interpreter deptry runs under; use the project's virtualenv executable for `command`. Without installed metadata deptry guesses that a package's module name equals its name.
- A transitive-dependency or module-name mapping decision is deptry's, not the adapter's.
