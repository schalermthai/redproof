# @redproof/vulture

Redproof adapter for [vulture](https://github.com/jendrikseipp/vulture): find dead Python code. Node-only: the adapter runs `vulture` as a subprocess and parses its text report (`file:line: unused X 'name' (NN% confidence)`), because vulture has no structured output.

```ts
import { defineGate } from 'redproof';
import { vulture } from '@redproof/vulture';

export default defineGate({
  id: 'python-dead-code',
  adapter: vulture({
    command: '.venv/bin/vulture',
    paths: ['src', 'whitelist.py'],
    minConfidence: 80,
    rules: { imports: 'unused-import', unreachable: 'unreachable-code' },
  }),
});
```

## Rules

Each entry of `rules` maps your alias to one finding kind and becomes the Redproof rule `vulture/<kind>`. A finding of a selected kind at or above `minConfidence` fails that rule.

| Rule | vulture reports | Usual confidence |
|---|---|---|
| `vulture/unused-import` | an import never used | 90 |
| `vulture/unused-function` | a function never called | 60 |
| `vulture/unused-class` | a class never used | 60 |
| `vulture/unused-method` | a method never called | 60 |
| `vulture/unused-variable` | a variable (or argument) never read | 60 (arguments 100) |
| `vulture/unused-attribute` | an attribute never read | 60 |
| `vulture/unused-property` | a property never read | 60 |
| `vulture/unreachable-code` | code after `return`/`raise`/..., an unsatisfiable `if`/`while`/ternary condition, an unreachable `else` | 100 |

An unknown kind, or the same kind twice, throws when the adapter is constructed.

## Options

| Option | Meaning |
|---|---|
| `rules` | alias to kind, at least one |
| `paths` | files and directories, relative to `cwd` (default `.`). Put whitelist modules here: names they mention count as used |
| `cwd` | working directory relative to the Gate root |
| `minConfidence` | integer 0 to 100, default 60 (everything vulture reports). Always passed to vulture |
| `exclude`, `ignoreNames`, `ignoreDecorators` | vulture's `--exclude`, `--ignore-names`, `--ignore-decorators` patterns (no commas, no leading dash) |
| `configFile` | opt in to a `[tool.vulture]` file relative to the Gate root |
| `command`, `timeoutMs`, `maxOutputBytes` | the executable, a time limit (default 60 s), an output cap (default 10 MiB) |

By default `--config` points at an empty file, so a project's own `exclude`, `ignore_names`, `ignore_decorators`, `paths` or `min_confidence` cannot hide a finding; the Gate's options are the whole configuration. With `configFile` the file's `exclude` can remove files the adapter cannot see, so a pass is only as strong as that file.

## When the check REFUSES instead of passing

| Code | Cause |
|---|---|
| `vulture-input-unread` | stderr says a file was not read: syntax error, bad encoding, missing path. Checked on every exit code, because exit 3 (findings) hides a syntax error elsewhere. Python warnings (e.g. `SyntaxWarning`) are not this |
| `vulture-input-invalid` | exit 1 with nothing explaining it |
| `vulture-nothing-inspected` | no Python file would be read (empty directory, only non-`.py` files, everything excluded) |
| `vulture-report-unrecognised` | a stdout line is not a finding the adapter understands (format drift, a traceback) |
| `vulture-report-inconsistent` | exit 0 with findings, or exit 3 without |
| `vulture-usage-error`, `vulture-unsuccessful` | exit 2, or any exit other than 0, 1, 3 (137, 139, ...) |
| `vulture-version-unknown` / `vulture-version-unsupported` | not vulture, or older than 2.12 (the first with `--config`) |
| `vulture-path-*` | a named path or config file is missing or outside the Gate root |
| `command-*` | the executable is missing, timed out, was killed, or its output passed the cap |

## Blind spots

- `# noqa` and `# noqa: V10x` comments suppress findings (vulture offers no way to turn them off).
- vulture treats test files specially and cannot see dynamic use: that is what whitelist modules and `ignoreNames` are for.
- `unreachable-code` merges every reachability message into one rule; the text report does not name the category.
- The file count behind `vulture-nothing-inspected` mirrors vulture's directory and `--exclude` rules; it is a guard against empty runs, not a list of what was read.
