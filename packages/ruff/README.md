# @redproof/ruff

Turn Ruff rule codes and families into independently provable Redproof Rules.

## Install

Requires Node.js 24 or later and Ruff 0.4.10 or later on `PATH` (or named with
`command`). Verified on Ruff 0.4.10, 0.8.6, 0.11.13, 0.14.14 and 0.17.5.

```bash
npm install --save-dev redproof @redproof/ruff
pip install ruff
```

## Features

- Gives each selected Ruff rule code or family its own Rule, `ruff/<selector>`.
- Treats Ruff's exit code 1 as findings (FAIL with named breaches), not as a crash.
- Refuses, instead of passing, whenever Ruff did not or could not look at something it was asked to check.
- Never rewrites files or leaves a cache behind (`--no-fix --no-cache`).

## Use

Start with a working Ruff setup and a
[Redproof configuration](https://github.com/schalermthai/redproof#install).

```ts
import { ruff } from '@redproof/ruff';
import { defineGate } from 'redproof';

const adapter = ruff({
  paths: ['src', 'tests'],
  rules: {
    unusedImports: 'F401', // Rule id: ruff/F401
    noAssert: 'S101',      // Rule id: ruff/S101
    bandit: 'S',           // a whole family: ruff/S
  },
});

export default defineGate({ id: 'python-lint', adapter });
```

Selectors are Ruff rule codes (`F401`) or families (`S`, `PLR`). Overlapping
selectors (`S` with `S101`) are rejected at construction, as are `ALL`, rule
names and category selectors. A family matches whole linter prefixes: `S` is
Bandit and never matches `SIM101`; `PL` covers `PLC`, `PLE`, `PLR` and `PLW`.

Options: `paths` (default the working directory), `cwd`, `configFile`,
`isolated`, `preview`, `ignoreNoqa`, `command`, `timeoutMs`, `maxOutputBytes`
(default 10 MiB). Paths must stay inside the Gate root, including symlink targets.

## Verdicts

- **FAIL**: a finding of a selected rule. Breaches carry the Ruff code, file, line, column, rule name, documentation link and whether Ruff offers a fix. Notebook findings say `Notebook cell N`; their line and column are relative to the cell.
- **REFUSE**: the evidence cannot be trusted. Each reason has its own code:

| Code | When |
|---|---|
| `command-unavailable`, `command-timeout`, `command-output-limit` | Ruff is missing, too slow, or its output exceeded `maxOutputBytes` |
| `ruff-version-unknown`, `ruff-version-unsupported` | the command is not Ruff, or is older than 0.4.10 |
| `ruff-environment-conflict` | `RUFF_OUTPUT_FILE` or `RUFF_OUTPUT_FORMAT` is set; Ruff would write the report elsewhere |
| `ruff-path-missing`, `ruff-path-outside-root`, `ruff-path-unreadable` | a named path, `cwd` or `configFile` is absent, outside the root, or unreadable |
| `ruff-unknown-rule`, `ruff-config-error` | Ruff rejected a selector or the configuration (including removed rules) |
| `ruff-nothing-inspected` | Ruff found no Python files, so a pass would mean nothing |
| `ruff-path-excluded` | Ruff dropped every file under a path you named (for example `force-exclude`) |
| `ruff-input-skipped` | Ruff printed a warning or error notice (unreadable directory, a file it failed to lint or parse, a panic, a preview rule that has no effect, a remapped code) |
| `ruff-syntax-error` | a file could not be parsed, so its rules were not evaluated |
| `ruff-unattributed-finding` | Ruff reported a rule no selector covers, for example `SIM111` is answered as `SIM110` |
| `ruff-report-unavailable`, `ruff-report-inconsistent`, `ruff-unsuccessful` | the JSON is unusable, the exit code and findings disagree, or Ruff crashed |

Ruff notices known to say nothing about what was checked (deprecated top-level
settings, incompatible-rule notes, malformed `# noqa` comments) do not refuse.
Any other notice does.

## Scope: what Ruff's own configuration can hide

Like the other Redproof adapters, this one treats your tool configuration as
the project's policy. Ruff decides which files are checked, so anything that
removes a file from Ruff's run removes it from the Gate, and the Gate can pass:

- `exclude`, `extend-exclude`, `include`, Ruff's default excludes (`dist`, `venv`, `site-packages` and others), `.gitignore` and `.ignore`.
- `per-file-ignores`, `# noqa` and `# ruff: noqa` / `# flake8: noqa` comments.
- Configuration outside the Gate root: a parent directory's `pyproject.toml` or `ruff.toml`, the user-level Ruff configuration, and a global gitignore all apply, because Ruff discovers them.

`--select` does override the project's `ignore` and `extend-select`, and
`force-exclude` on a named path refuses (above). The size of the checked set is
reported as `scan.inspected` on every PASS and FAIL, so a shrinking count is visible.

To make the verdict depend only on the tree and the options, pass
`isolated: true`: Ruff then ignores all discovered configuration, so
`configFile` cannot be combined with it. Use `ignoreNoqa: true` to report
findings that `# noqa` comments suppress.

## Limits

- The command is resolved from `PATH` unless `command` is a path. Use an absolute path in CI.
- Files Ruff cannot read as Python (a NUL byte, an unsupported encoding declaration) REFUSE.
- `check.run` evaluates every selected Rule, whatever subset it is asked for.
- Ruff releases newer than 0.17.5 are accepted but not yet verified.

## License

Apache-2.0
