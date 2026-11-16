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

Options: `cwd`, `command` (default `tach`), `timeoutMs`, `maxOutputBytes`, and three explicit acknowledgements, all off by default:

| Option | Accepts |
| --- | --- |
| `allowInactiveRules` | a selected rule whose configuration is missing or off (see below) |
| `allowIgnoredSources` | gitignored Python files under a source root that tach will not read |
| `allowUnverifiedVersion` | a tach newer than the newest verified minor |

No flag that narrows the run is offered.

`unused-dependency` (tach `--exact`) and the external-package checks cannot be selected: tach prints them only as text, so selecting them throws at construction.

## REFUSE, never PASS

A run that did not finish, or whose output cannot be trusted, REFUSES: missing/old/unknown tach, timeout, output limit, signal, any exit code other than 0 and 1, output that is not JSON, an `{"error": ...}` object, exit code and report disagreeing, any configuration diagnostic (a skipped file, a missing module or source root, no first-party import to inspect), and any diagnostic variant this adapter does not know. tach stops at a cycle or visibility error before it evaluates anything else, so a Gate that selects another rule beside it REFUSES instead of passing the rest.

A project whose modules import nothing of each other has nothing for tach to inspect (it warns `NoFirstPartyImportsFound`), so it REFUSES rather than passes. That is deliberate: the report would be empty whether the boundaries hold or not.

**Version policy.** The evidence is tach 0.35.3. Older releases REFUSE (`tach-version-unsupported`). A patch release of 0.35 runs. A newer minor (0.36, 1.0) REFUSES (`tach-version-unverified`) until someone re-runs the battery, because tach is 0.x and has changed defaults between minors, which would not show up as an unknown diagnostic. `allowUnverifiedVersion` runs it anyway. A diagnostic variant this adapter has never seen always REFUSES.

## A selected rule must have its evidence switched on

tach prints a clean report for a rule whose configuration is missing or turned off. A Gate that selects the rule is asking for that check, so these REFUSE (`tach-rule-inactive`, naming the cause) unless `allowInactiveRules` acknowledges them. Only the root `tach.toml` and distributed `tach.domain.toml` files are read, with a structural TOML scanner: a comment, a string, a multi-line string or another table cannot pass for a setting.

| Selected rule | REFUSES when |
| --- | --- |
| `circular-dependency` | top-level `forbid_circular_dependencies = true` is not set. **No opt-in**: it is one line, and tach prints `[]` for a real cycle without it (`tach-cycle-check-off`) |
| `undeclared-dependency` | a module has neither `depends_on` nor `layer` (tach lets it import anything) |
| `forbidden-dependency` | no module sets `cannot_depend_on` |
| `deprecated-dependency` | no dependency is marked `deprecated = true` |
| `layer-violation` | no `layers` are defined |
| `interface-violation` | no `[[interfaces]]` are defined |
| `visibility-violation` | no module or interface sets `visibility` |
| `ignore-directive` | `[rules] unused_ignore_directives = "off"`. (`require_ignore_directive_reasons` is off in tach by default, so reasons are enforced only when the project turns it on) |
| any import rule | `[rules] local_imports = "off"`, a module with `unchecked = true`, or `exclude` removing a whole module |

**Gitignored sources.** tach skips every file an ignore file names, in any ancestor directory and even outside a git repository, and prints nothing about it. In a git repository the adapter asks `git ls-files --others --ignored`; outside one it asks a throwaway git directory pointed at the highest ancestor holding a `.gitignore`. Ignored `.py` files under a `source_roots` entry REFUSE (`tach-ignored-sources`), except environments and caches (`.venv`, `node_modules`, `site-packages`, `.tox`, ...) and paths the project's own `exclude` removes. If git cannot answer, that REFUSES too (`tach-ignored-sources-unknown`). `respect_gitignore = false` in tach.toml makes tach read them and silences the check; `allowIgnoredSources` acknowledges it. `.ignore` files (ripgrep style) are not inspected.

**Source roots** outside the Gate root, by `..`, an absolute path or a symlink, REFUSE (`tach-path-outside-root`).

## Blind spots that remain (tach decides, and prints a clean report)

These cannot be told from the JSON or from the configuration, so they are documented rather than refused:
- `exclude` patterns that remove some files of a module (only whole-module exclusion is detected), and tach's default `exclude` of `**/tests`, `**/docs`, `**/venv` when the project sets none.
- `# tach-ignore` on an import. The `ignore-directive` rule audits directives but a needed one still silences its import.
- Imports under `if TYPE_CHECKING:` (`ignore_type_checking_imports` defaults to true), string imports and dynamic imports (`include_string_imports` defaults to false).
- Files outside `source_roots`, notebooks, `.ignore` files, and a module `layer` that no `layers` entry defines (tach raises nothing).
- `UnnecessarilyIgnoredDependency` exists in tach's diagnostic enum but tach 0.35.3 never constructs it (it is only formatted), so it cannot be produced; if a newer tach prints it, it is an unknown variant and REFUSES.

Evidence for each: `22-tach/REDPROOF_TACH_BATTLE_TEST.md`. Verified against tach 0.35.3.
