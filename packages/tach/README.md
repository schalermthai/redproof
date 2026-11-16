# @redproof/tach

Redproof adapter for [tach](https://github.com/gauge-sh/tach), the Python module-boundary checker. It runs `tach check --output json` and turns each diagnostic of a selected kind into a Breach.

```ts
import { tach } from '@redproof/tach';
import { defineGate } from 'redproof';

const adapter = tach({
  rules: {
    undeclared: 'undeclared-dependency',
    layers: 'layer-violation',
    interfaces: 'interface-violation',
    cycles: 'circular-dependency',
  },
});

export default defineGate({ id: 'python-boundaries', adapter });
```

tach and its `tach.toml` must be in place: this adapter runs the tool, it does not install it. `tach.toml` must sit in `cwd` (default: the Gate root); tach would otherwise borrow a config from a parent directory.

## Rules

| Option value | Rule ID | tach diagnostics |
| --- | --- | --- |
| `undeclared-dependency` | `tach/undeclared-dependency` | UndeclaredDependency |
| `forbidden-dependency` | `tach/forbidden-dependency` | ForbiddenDependency (`cannot_depend_on`) |
| `deprecated-dependency` | `tach/deprecated-dependency` | DeprecatedDependency (tach reports it as a warning; a selected rule still fails) |
| `layer-violation` | `tach/layer-violation` | LayerViolation, ClosedLayerViolation |
| `interface-violation` | `tach/interface-violation` | PrivateDependency, InvalidDataTypeExport |
| `ignore-directive` | `tach/ignore-directive` | UnusedIgnoreDirective, MissingIgnoreDirectiveReason, UnnecessarilyIgnoredDependency |
| `circular-dependency` | `tach/circular-dependency` | the "Circular dependency" stop |
| `visibility-violation` | `tach/visibility-violation` | the "Visibility error" stop |

Options: `cwd`, `command` (default `tach`), `timeoutMs`, `maxOutputBytes`. No flag that narrows the run is offered.

`unused-dependency` (tach `--exact`) and the external-package checks cannot be selected: tach prints them only as text, so selecting them throws at construction.

## REFUSE, never PASS

A run that did not finish, or whose output cannot be trusted, REFUSES: missing/old/unknown tach, timeout, output limit, signal, any exit code other than 0 and 1, output that is not JSON, an `{"error": ...}` object, exit code and report disagreeing, any configuration diagnostic (a skipped file, nothing to inspect, a missing module, a missing source root), and any diagnostic variant this adapter does not know. tach stops at a cycle or visibility error before it evaluates anything else, so a Gate that selects another rule beside it REFUSES instead of passing the rest.

## Blind spots (tach decides, and prints a clean report)

Project configuration can hide findings without a trace: `unchecked = true` modules, `exclude` that removes only some files, `# tach-ignore`, `local_imports = "off"`, `forbid_circular_dependencies` unset, files outside `source_roots`, notebooks, and a module `layer` that no `layers` entry defines. Evidence for each: `22-tach/REDPROOF_TACH_BATTLE_TEST.md`. Verified against tach 0.35.3; older releases are refused.
