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
| `ignore-directive` | `tach/ignore-directive` | UnusedIgnoreDirective, MissingIgnoreDirectiveReason |
| `circular-dependency` | `tach/circular-dependency` | the "Circular dependency" stop |
| `visibility-violation` | `tach/visibility-violation` | the "Visibility error" stop |

Options: `cwd`, `command` (default `tach`), `timeoutMs`, `maxOutputBytes`, and three explicit acknowledgements, all off by default:

| Option | Accepts |
| --- | --- |
| `allowInactiveRules` | a selected rule whose configuration is missing or off (see below) |
| `allowIgnoredSources` | Python files under a source root that tach will not read: hidden by an ignore file, or reached only through a symbolic link |
| `allowUnverifiedVersion` | a tach newer than the newest verified minor |

No flag that narrows the run is offered.

`unused-dependency` (tach `--exact`) and the external-package checks cannot be selected: tach prints them only as text, so selecting them throws at construction.

## REFUSE, never PASS

A run that did not finish, or whose output cannot be trusted, REFUSES: missing/old/unknown tach, timeout, output limit, signal, any exit code other than 0 and 1, output that is not JSON, an `{"error": ...}` object, exit code and report disagreeing, any configuration diagnostic (a skipped file, a missing module or source root, no first-party import to inspect), and any diagnostic variant this adapter does not know. tach stops at a cycle or visibility error before it evaluates anything else, so a Gate that selects another rule beside it REFUSES instead of passing the rest.

A project whose modules import nothing of each other has nothing for tach to inspect (it warns `NoFirstPartyImportsFound`), so it REFUSES rather than passes. That is deliberate: the report would be empty whether the boundaries hold or not.

**Which outcome wins.** Every step before the last can only end in REFUSE, so an ambiguous run never passes. First match wins:

1. Path outside the Gate root, no `tach.toml` in the working directory, a `tach.toml` that is not valid TOML (`tach-config-unreadable`), a directory or `tach.domain.toml` that could not be read (`tach-domain-config-unreadable`), or a thrown error.
2. `tach --version`: command refused, not tach, too old, or newer than the verified minor.
3. Configuration guards: source root outside the Gate root, cycle check off, an inactive selected rule, ignored sources, symlinked sources.
4. `tach check`: command refused or timed out, exit code other than 0 or 1, report not JSON, an `{"error": ...}` object, exit code and report disagreeing, a structural stop, any configuration diagnostic, an unknown diagnostic variant.
5. Only then Breaches (FAIL) or none (PASS).

So REFUSE beats FAIL: a real violation printed beside a skipped file or an unknown diagnostic REFUSES, because a partial view must not fail (or pass) a Gate on its own. Distributed `tach.domain.toml` files are looked for in every directory below the working directory, to any depth, except hidden directories, `node_modules`, `venv`, `__pycache__` and `site-packages` (tach's own walker skips hidden ones; the others are environments).

**Version policy.** The evidence is tach 0.35.3. Older releases REFUSE (`tach-version-unsupported`). A patch release of 0.35 runs. A newer minor (0.36, 1.0) REFUSES (`tach-version-unverified`) until someone re-runs the battery, because tach is 0.x and has changed defaults between minors, which would not show up as an unknown diagnostic. `allowUnverifiedVersion` runs it anyway. A diagnostic variant this adapter has never seen always REFUSES.

## A selected rule must have its evidence switched on

tach prints a clean report for a rule whose configuration is missing or turned off. A Gate that selects the rule is asking for that check, so these REFUSE (`tach-rule-inactive`, naming the cause) unless `allowInactiveRules` acknowledges them. Only the root `tach.toml` and distributed `tach.domain.toml` files are read, with a real TOML parser ([smol-toml](https://github.com/squirrelchat/smol-toml), the package's one runtime dependency besides `redproof`): inline tables, quoted keys and headers, dotted keys and comments all reach the same tree, so a setting cannot hide behind a spelling. A file that is not TOML, or holds a value of the wrong type, REFUSES (`tach-config-unreadable`); it is never guessed at.

| Selected rule | REFUSES when |
| --- | --- |
| `circular-dependency` | top-level `forbid_circular_dependencies = true` is not set. **No opt-in**: it is one line, and tach prints `[]` for a real cycle without it (`tach-cycle-check-off`) |
| `undeclared-dependency` | a module has neither `depends_on` nor `layer`, or a `depends_on` entry that matches every module such as `**` (tach lets it import anything) |
| `forbidden-dependency` | no module sets `cannot_depend_on` |
| `deprecated-dependency` | no dependency is marked `deprecated = true` |
| `layer-violation` | no `layers` are defined, or no checked module sets `layer` |
| `interface-violation` | no `[[interfaces]]` are defined, or none has a `from` that matches a checked module |
| `visibility-violation` | no module or interface sets `visibility` |
| `ignore-directive` | `[rules] unused_ignore_directives = "off"`. (`require_ignore_directive_reasons` is off in tach by default, so reasons are enforced only when the project turns it on) |
| any import rule | `[rules] local_imports = "off"`, a module with `unchecked = true`, or `exclude` removing a module or any Python file a module owns. Code no module owns is unchecked by default (`root_module = "ignore"`), so excluding it hides nothing; under `allow`, `forbid` or `dependenciesonly` every excluded file counts |

**Ignored and symlinked sources.** The adapter walks the project itself (without following links, ignoring `.gitignore`) and compares what it finds with every way tach has of skipping a file. tach 0.35 reports nothing about which files it read (`tach map` lists only files that import another module), so the comparison is by reasons, not by tach's own list, and each reason is a question about the same walk:

- *Ignore files.* tach skips every file an ignore file names, in any ancestor directory, even outside a git repository, and even for a file git tracks. In a git repository the adapter asks `git ls-files --cached --others --ignored`; outside one, a throwaway git directory pointed at the highest ancestor holding a `.gitignore`. A `.ignore` file (ripgrep style) is read by tach and not by git, so any `.ignore` in the project or above it REFUSES. Python files from the walk that match REFUSE (`tach-ignored-sources`). Directories holding `pyvenv.cfg` are environments and are not walked. If git cannot answer, that REFUSES too (`tach-ignored-sources-unknown`).
- *`respect_gitignore = false`* switches off `.gitignore` and `.ignore`, not `.git/info/exclude`, which the adapter still lists.
- *Symbolic links.* tach does not follow a link to a directory or to a `.py` file and prints nothing. Any such link under a source root REFUSES (`tach-symlinked-sources`).
- *Source roots* are compared as paths: `src`, `src/.`, `./src//` and `././src` are one directory.
- tach 0.35 has **no default `exclude`** when `tach.toml` sets none (its `init` writes one, the loader does not apply it): `tests/`, `docs/` and `venv/` are read like any directory.

`allowIgnoredSources` acknowledges ignored and symlinked sources alike.

**Source roots** outside the Gate root, by `..`, an absolute path or a symlink, REFUSE (`tach-path-outside-root`).

## Blind spots that remain (tach decides, and prints a clean report)

These cannot be told from the JSON or from the configuration, so they are documented rather than refused:
- `exclude` of code that no module owns while `root_module` is `ignore`: tach does not check that code in any case.
- `# tach-ignore` on an import. The `ignore-directive` rule audits directives but a needed one still silences its import.
- Imports under `if TYPE_CHECKING:` (`ignore_type_checking_imports` defaults to true), string imports and dynamic imports (`include_string_imports` defaults to false).
- Files outside `source_roots`, notebooks, and a module `layer` that no `layers` entry defines (tach raises nothing).
- `UnnecessarilyIgnoredDependency` exists in tach's diagnostic enum but tach 0.35.3 never constructs it (it is only formatted), so it cannot be produced; if a newer tach prints it, it is an unknown variant and REFUSES.

Evidence for each: `22-tach/REDPROOF_TACH_BATTLE_TEST.md`. Verified against tach 0.35.3.
