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
| `paths` | directories to scan, relative to `cwd` (default `.`). Passed to deptry relative to `cwd`, because its exclude patterns match from the start of a relative path |
| `cwd` | working directory relative to the Gate root: where deptry reads `pyproject.toml` / requirements files |
| `configFile` | a pyproject file relative to the Gate root (`--config`) |
| `ignoreNotebooks` | `--ignore-notebooks` |
| `exclude` | `--exclude` regular expressions; default is deptry's own: `venv`, `\.venv`, `\.direnv`, `tests`, `\.git`, `setup\.py` |
| `extendExclude` | more `--extend-exclude` regular expressions |
| `allowPerRuleIgnores`, `allowKnownFirstParty`, `allowPackageModuleNameMap`, `allowDependencyGroups` | accept the project's own value of the settings named below |
| `command`, `timeoutMs`, `maxOutputBytes` | the executable, a time limit (default 60 s), an output cap (default 10 MiB) |

## Project settings that could hide a finding

deptry reads `[tool.deptry]` from the project. Several of its keys can erase a finding of a rule you selected, so the adapter overrides each on the command line and then checks deptry's own `--verbose` echo of the settings it used. Anything that differs is `REFUSE`, never a pass.

| Setting | What the adapter does |
|---|---|
| `ignore` | `--ignore=` always; echo must be `('',)` |
| `per_rule_ignores` | `--per-rule-ignores=DEP001=-redproof-none-` (a package name cannot start with a dash, so it ignores nothing); `allowPerRuleIgnores` accepts the project's |
| `known_first_party`, `experimental_namespace_package` | `--known-first-party=`; `allowKnownFirstParty` accepts the project's (a src-layout project deptry misdetects needs it) |
| `package_module_name_map` | overridden the same way; `allowPackageModuleNameMap` accepts the project's |
| `exclude`, `extend_exclude` | always passed from the Gate's `exclude` / `extendExclude`; the project's never apply |
| `optional_dependencies_dev_groups`, `non_dev_dependency_groups` | not overridable; present and non-empty is `REFUSE` unless `allowDependencyGroups` |

Passing `--exclude` has a second effect that the adapter relies on: deptry then stops reading `.gitignore`, `.ignore`, `.git/info/exclude` and the global git ignore file, so the files scanned do not depend on the machine or on being inside a git work tree. (`.gitignore` is only read while `--exclude` is left at its default.) The echo block is read only between its header and the first blank line, every line must be `key: value`, and a repeated key is rejected, so text in a project path cannot forge a line.

## When the check REFUSES instead of passing

deptry exits 0 in several situations where nothing was really checked, and exits 1 both for findings and for a crash. The adapter refuses (with the code below) rather than pass or fail on such a run:

| Code | Cause |
|---|---|
| `deptry-input-skipped` | a file could not be parsed (`Skipping processing of ...`) or a requirement could not be read |
| `deptry-nothing-inspected` / `deptry-scan-unreadable` | zero files scanned, or no scan line |
| `deptry-report-unavailable` | no report written: a crash, a missing or malformed `pyproject.toml`, no dependency specification |
| `deptry-config-not-applied` | the echo shows a project setting from the table above still in force |
| `deptry-config-unreadable` | the echo block is missing, malformed, or lacks a key the adapter needs |
| `deptry-environment-incomplete` | a declared package is not installed in deptry's environment, so deptry guessed its module name (`Assuming the corresponding module name of package ...`). Affects DEP001 to DEP004; DEP005 only compares a name with the standard library. Run the project's own deptry, or list the packages in `package_module_name_map` and set `allowPackageModuleNameMap` |
| `deptry-report-inconsistent`, `deptry-report-invalid` | exit code and report disagree, or the report is not the expected JSON |
| `deptry-usage-error`, `deptry-unsuccessful` | exit 2, or any other unexpected exit (137, 139, ...) |
| `deptry-version-unknown` / `deptry-version-unsupported` | not deptry, or older than 0.21.2. The native tests pass on 0.21.2, 0.23.1, 0.24.0 and 0.25.1 (run 2026-11-16); 0.20 and older failed them. CI runs 0.21.2 and 0.25.1 |
| `deptry-path-*` | a named path or config file is missing or outside the Gate root |
| `command-*` | the executable is missing, timed out, was killed, or its output passed the cap |

## Blind spots

- `# deptry: ignore[...]` comments in source are honoured (deptry offers no way to turn them off).
- DEP001, DEP003 and DEP004 depend on the package metadata installed in the interpreter deptry runs under; use the project's virtualenv executable for `command`.
- `-v` output is larger than normal; raise `maxOutputBytes` on very large projects (hitting the cap REFUSES).
- A `.venv` outside the scanned paths needs no exclusion; one inside is left out by the default `exclude`, and replacing `exclude` replaces that default too.
- Windows is untested.
