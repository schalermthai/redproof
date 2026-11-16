# @redproof/mypy

Redproof adapter for [mypy](https://mypy-lang.org). Each selected mypy **error code** becomes one Redproof Rule `mypy/<code>`.
Any error of a selected code fails the Gate. mypy not finishing, a setting that can hide findings, or a project with
nothing to check **refuses**: a run that did not finish never passes.

```ts
import { mypy } from '@redproof/mypy';
import { defineGate } from 'redproof';

export default defineGate({
  id: 'python-types',
  adapter: mypy({
    rules: { args: 'arg-type', returns: 'return-value', untyped: 'no-untyped-def' },
    paths: ['src'],
    pythonVersion: '3.12',
    platform: 'linux',
  }),
});
```

mypy must be installed in the Python named by `python` (default `python3`, ideally the project's virtual environment:
mypy type-checks against the packages that interpreter can see). mypy 1.11.0 or newer is required, because
`--output json` first appeared there; older releases refuse with `mypy-version-unsupported`.

## Rules

Selecting a code selects that code and its sub-codes (`import` covers `import-not-found` and `import-untyped`; `assignment` covers
`method-assign`). Two selected codes may not overlap. A code is selectable only if a minimal program went red at the Gate with that
code alone, an empty configuration, and green once fixed; a code that mypy keeps silent unless a flag asks for it gets that
flag from the adapter, because enabling the code alone would pass for the wrong reason.

| Rule code | Flag the adapter raises for it |
|---|---|
| `abstract` |  |
| `arg-type` |  |
| `assert-type` |  |
| `assignment` |  |
| `attr-defined` |  |
| `await-not-async` |  |
| `call-arg` |  |
| `call-overload` |  |
| `comparison-overlap` | `--strict-equality` |
| `deprecated` |  |
| `dict-item` |  |
| `empty-body` |  |
| `exhaustive-match` |  |
| `exit-return` |  |
| `explicit-any` | `--disallow-any-explicit` |
| `explicit-override` |  |
| `func-returns-value` |  |
| `ignore-without-code` |  |
| `import` |  |
| `import-not-found` |  |
| `import-untyped` |  |
| `index` |  |
| `list-item` |  |
| `method-assign` |  |
| `misc` |  |
| `mutable-override` |  |
| `name-defined` |  |
| `name-match` |  |
| `no-any-return` | `--warn-return-any` |
| `no-overload-impl` |  |
| `no-redef` |  |
| `no-untyped-call` | `--disallow-untyped-calls` |
| `no-untyped-def` | `--disallow-untyped-defs` |
| `operator` |  |
| `overload-cannot-match` |  |
| `overload-overlap` |  |
| `override` |  |
| `possibly-undefined` |  |
| `redundant-cast` | `--warn-redundant-casts` |
| `redundant-expr` |  |
| `redundant-self` |  |
| `return` |  |
| `return-value` |  |
| `str-bytes-safe` |  |
| `str-format` |  |
| `truthy-bool` |  |
| `truthy-function` |  |
| `truthy-iterable` |  |
| `type-abstract` |  |
| `type-arg` | `--disallow-any-generics` |
| `type-var` |  |
| `typeddict-item` |  |
| `typeddict-unknown-key` |  |
| `unimported-reveal` |  |
| `union-attr` |  |
| `unreachable` | `--warn-unreachable` |
| `untyped-decorator` | `--disallow-untyped-decorators` |
| `unused-awaitable` |  |
| `unused-coroutine` |  |
| `unused-ignore` | `--warn-unused-ignores` |
| `used-before-def` |  |
| `valid-type` |  |
| `var-annotated` |  |

Every selected code is also enabled with `--enable-error-code`, which the optional codes (such as `possibly-undefined`) need.
`syntax` and `annotation-unchecked` cannot be rules: a syntax error stops mypy before any rule runs, so it always refuses.

## How a check runs

1. A short Python probe (`python -I`) calls mypy's own option parser, twice: once as the project is configured, once with no
   configuration. The difference is exactly what the project's configuration changes.
2. The adapter judges those facts (below). A second probe then builds the program the way mypy will and lists **everything mypy
   loaded**, not only the files named. For each loaded project file it reads what no option shows: `# mypy:` comments,
   `# type: ignore` comments and `@no_type_check`. It also walks the named paths itself, without mypy's discovery rules, to list every
   Python file the Gate promised.
3. **The one comparison:** every promised file must have been loaded, and every loaded file must be free of ways to hide findings.
   Whatever mypy did not check, or checked with its eyes shut, is a refusal.
4. `python -I -m mypy --output json` runs with the same arguments, the configuration file pinned to the one that was judged, and a
   private cache outside the project. Findings of selected codes are breaches. Errors of other codes are normal and ignored.
   Notes are never breaches.

Flags the adapter always passes: `--check-untyped-defs` (mypy skips untyped function bodies by default, so an unannotated
project would pass), `--warn-unused-ignores`, `--warn-unreachable` (mypy never checks code it thinks is dead; this makes it say so), `--no-incremental` and a throwaway `--cache-dir` (so no `.mypy_cache` appears in
the tree and a stale cache cannot answer), and `--enable-error-code` for every selected code.

`-I` means a `mypy.py` or `mypy/` folder in the project cannot replace the tool, and `PYTHON*` variables are ignored.
`MYPYPATH`, `MYPY_ALT_LIB_PATH` and `MYPY_CACHE_DIR` are removed from the environment of the run.

## What refuses

| Code | When |
|---|---|
| `mypy-unavailable`, `mypy-probe-failed`, `mypy-probe-unavailable` | the interpreter cannot import mypy, or died before the probe answered |
| `mypy-version-unsupported`, `mypy-version-unknown` | older than 1.11.0, or not mypy |
| `mypy-usage-error`, `mypy-unknown-rule` | mypy rejected its arguments or configuration, or does not know a selected code |
| `mypy-config-warning` | mypy complained while reading its configuration (an unrecognised option, a clamped `python_version`) |
| `mypy-config-outside-root` | the configuration mypy found, or `mypy_path`, is outside the Gate root; a user-level file differs per machine |
| `mypy-host-dependent` | `pythonVersion` or `platform` is not pinned by the Gate or the configuration |
| `mypy-nothing-inspected`, `mypy-path-excluded` | no Python files, or a path the Gate named contributed none |
| `mypy-setting-hides-findings` | `ignore_errors`, `follow_imports = skip/silent`, `ignore_missing_imports`, `exclude`, `always_true/false`, `plugins`, or a `[mypy-x]` section that disables a selected code |
| `mypy-setting-unvetted` | a setting not on the adapter's list of settings that cannot hide a finding or change the tree (a section turning `check_untyped_defs` off, `strict_optional = False`, `junit_xml`, `*_report`, `install_types`, anything new) |
| `mypy-inline-config` | a `# mypy:` comment in a source file |
| `mypy-ignore-comments` | a `# type: ignore` before the first statement (whole file), or one that suppressed an error a selected rule could report; a list such as `[assignment, call-arg]` is judged code by code |
| `mypy-files-unchecked` | a Python file under a named path that mypy never loaded: a `.py` beside a `.pyi`, a hidden directory, anything mypy's own discovery skips (`node_modules`, `site-packages`, `__pycache__`, VCS and tool-cache folders are not promised) |
| `mypy-no-type-check` | a function or class decorated with `@no_type_check` (also `typing.no_type_check` and an alias), whose body mypy skips without a word |
| `mypy-unreachable-code` | mypy found code it considers unreachable (`--warn-unreachable`); select `unreachable` to make it a rule, or allow it |
| `mypy-imports-unresolved` | an import mypy typed as `Any`; the result would depend on which stubs the host has |
| `mypy-syntax-error`, `mypy-crashed`, `mypy-unsuccessful`, `mypy-unexpected-stderr` | exit 2, an exit code mypy does not document, or stderr output on a run that reported a result |
| `mypy-report-unavailable`, `mypy-report-inconsistent`, `mypy-unattributed-finding`, `mypy-not-evaluated` | truncated or garbled JSON, exit 0 with output, exit 1 with none, an error with no code, a skipped untyped body |
| `command-timeout`, `command-signaled`, `command-output-limit`, `command-unavailable` | the run was killed, timed out, produced too much, or could not start |

Use `allow` to accept a setting knowingly. Each name accepts exactly one thing, and the verdict is then weaker than
"mypy reports nothing": `type-ignore`, `inline-config`, `ignore-errors`, `ignore-missing-imports`, `unresolved-imports`,
`follow-imports`, `disabled-codes`, `exclude`, `reachability`, `plugins`, `host-defaults`, `skipped-files`, `no-type-check`, `unreachable-code`.

## Options

`rules`, `paths`, `cwd`, `configFile`, `isolated` (ignore every configuration file), `pythonVersion`, `platform`, `allow`, `python`,
`timeoutMs` (default 5 minutes), `maxOutputBytes`.

Without `configFile` or `isolated`, mypy finds its own configuration, and that file must lie inside the Gate root.

## Blind spots

What the one comparison cannot see. Each of these can still give a PASS that says less than it seems:

- Code behind a condition mypy evaluates as false: `sys.platform` and `sys.version_info` branches for the pinned version and platform (your choice,
  made explicit by `pythonVersion` and `platform`), `if not TYPE_CHECKING:`, and dead code after `assert False` or a `NoReturn` call. `--warn-unreachable`
  does not report these.
- The verdict depends on the packages and stubs installed for `python`. Missing ones surface as `import-not-found` / `import-untyped`, which refuse, but a
  different version of a library can still change a finding.
- Files from installed packages and typeshed are not scanned for ignore comments (mypy does not report their errors).
- A `# type: ignore[code]` that suppressed an error of a code you did not select is fine; a bare one that suppressed anything refuses, so a project with
  many ignores needs `allow: ['type-ignore']`.
- The message of an `unused-ignore` finding is read only to tell which codes of a comment were unused. A message in a shape this adapter does not know is
  treated as "used", which refuses; it never passes.
- The configuration is read once by the probe and again by the run, which is pinned to the same file; a program that rewrites its own configuration between the
  two is not detected.
- Plugins run arbitrary code inside mypy; accepting them with `allow: ['plugins']` accepts what they do.
