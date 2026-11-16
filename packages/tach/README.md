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

Options: `cwd`, `command` (default `tach`), `timeoutMs`, `maxOutputBytes`, and four explicit acknowledgements, all off by default:

| Option | Accepts |
| --- | --- |
| `allowInactiveRules` | a selected rule whose configuration is missing or off (see below) |
| `allowIgnoredSources` | that tach may skip Python files under a source root: an ignore file, a nested repository, a symbolic link |
| `allowExcludedSources` | an `exclude` that is more than environment and cache directories (`tach init` writes one for tests and docs) |
| `allowUnverifiedVersion` | a tach newer than the newest verified minor |

No flag that narrows the run is offered.

`unused-dependency` (tach `--exact`) and the external-package checks cannot be selected: tach prints them only as text, so selecting them throws at construction.

## REFUSE, never PASS

A run that did not finish, or whose output cannot be trusted, REFUSES: missing/old/unknown tach, timeout, output limit, signal, any exit code other than 0 and 1, output that is not JSON, an `{"error": ...}` object, exit code and report disagreeing, any configuration diagnostic (a skipped file, a missing module or source root, no first-party import to inspect), and any diagnostic variant this adapter does not know. tach stops at a cycle or visibility error before it evaluates anything else, so a Gate that selects another rule beside it REFUSES instead of passing the rest.

A project whose modules import nothing of each other has nothing for tach to inspect (it warns `NoFirstPartyImportsFound`), so it REFUSES rather than passes. That is deliberate: the report would be empty whether the boundaries hold or not.

**Which outcome wins.** Every step before the last can only end in REFUSE, so an ambiguous run never passes. First match wins:

1. Path outside the Gate root, no `tach.toml` in the working directory, a `tach.toml` that is not valid TOML (`tach-config-unreadable`), a directory or `tach.domain.toml` that could not be read (`tach-domain-config-unreadable`), or a thrown error.
2. `tach --version`: command refused, not tach, too old, or newer than the verified minor.
3. Configuration guards: source root outside the Gate root, overlapping source roots, cycle check off, an inactive selected rule, sources tach may skip (`exclude`, ignore files, nested repository, symlinks).
4. `tach check`: command refused or timed out, exit code other than 0 or 1, report not JSON, an `{"error": ...}` object, exit code and report disagreeing, a structural stop, any configuration diagnostic, an unknown diagnostic variant.
5. Only then Breaches (FAIL) or none (PASS).

So REFUSE beats FAIL: a real violation printed beside a skipped file or an unknown diagnostic REFUSES, because a partial view must not fail (or pass) a Gate on its own. Distributed `tach.domain.toml` files are looked for in every directory below the working directory, to any depth, except hidden directories (tach's own walker skips those and nothing else), but only the ones inside a source root count: tach reads no others.

**Version policy.** The evidence is tach 0.35.3. Older releases REFUSE (`tach-version-unsupported`). A patch release of 0.35 runs. A newer minor (0.36, 1.0) REFUSES (`tach-version-unverified`) until someone re-runs the battery, because tach is 0.x and has changed defaults between minors, which would not show up as an unknown diagnostic. `allowUnverifiedVersion` runs it anyway. A diagnostic variant this adapter has never seen always REFUSES.

## A selected rule must have its evidence switched on

tach prints a clean report for a rule whose configuration is missing or turned off. A Gate that selects the rule is asking for that check, so these REFUSE (`tach-rule-inactive`, naming the cause) unless `allowInactiveRules` acknowledges them. Only the root `tach.toml` and distributed `tach.domain.toml` files are read, with a real TOML parser ([smol-toml](https://github.com/squirrelchat/smol-toml), the package's one runtime dependency besides `redproof`): inline tables, quoted keys and headers, dotted keys and comments all reach the same tree, so a setting cannot hide behind a spelling. A file that is not TOML, or holds a value of the wrong type, REFUSES (`tach-config-unreadable`); it is never guessed at.

| Selected rule | REFUSES when |
| --- | --- |
| `circular-dependency` | top-level `forbid_circular_dependencies = true` is not set. **No opt-in**: it is one line, and tach prints `[]` for a real cycle without it (`tach-cycle-check-off`) |
| `undeclared-dependency` | a module has neither `depends_on` nor `layer`, or a `depends_on` entry made only of wildcards such as `**` (tach lets it import anything). Any glob character in a `depends_on` entry (`**`, `?*`, `[!_]*`, `{*,x}`, `b.*`) counts, because a glob cannot be told from a list of names; listing every module by name opens it as well and is not detected |
| `forbidden-dependency` | no module sets `cannot_depend_on` |
| `deprecated-dependency` | no dependency is marked `deprecated = true` |
| `layer-violation` | no `layers` are defined, or no checked module sets `layer` |
| `interface-violation` | no `[[interfaces]]` are defined, or none has a `from` that matches a checked module |
| `visibility-violation` | no module or interface sets `visibility` |
| `ignore-directive` | `[rules] unused_ignore_directives = "off"`. (`require_ignore_directive_reasons` is off in tach by default, so reasons are enforced only when the project turns it on) |
| any import rule | `[rules] local_imports = "off"`, a module with `unchecked = true` |

**Sources tach may skip.** tach 0.35.3 cannot say which files it read: `tach check` prints no list, and `tach map`, `report` and `show` print only files that import another module, so there is nothing to compare the adapter's own walk with. Rather than re-implement tach's skipping rules (its globs, its gitignore engine) the adapter refuses whenever something that could make tach skip a file is present, and does not claim finer detection. The walk skips hidden directories, as tach does, and nothing else (`node_modules`, `__pycache__`, `site-packages` and directories holding `pyvenv.cfg` are all read by tach). REFUSES (`tach-ignored-sources`, `tach-ignored-sources-unknown`, `tach-symlinked-sources`):

- *An `exclude` that is more than a plain environment or cache directory.* The adapter does not interpret tach's glob syntax (braces, `[!x]`, escapes, trimming), so it compares each entry as a whole string with a short list of spellings that name one directory and nothing else (`.venv`, `venv`, `node_modules`, `__pycache__`, `.git`, `.tox`, `build`, `dist`, egg-info; for example `**/venv`, `build/`, `/dist`, `**/*__pycache__`) and refuses every other entry. A name is not trusted either: such an entry also refuses when the walk finds a Python or domain file under a directory of that name (`src/a/build/impl.py` under `exclude = ["**/build"]`), unless the directory is a real virtual environment (see below). That includes `tests` and `docs`, which `tach init` writes, so an initialised project refuses until `allowExcludedSources`. An environment entry that names a module is refused too.
- *Any `.ignore` file* in the project or above it (tach reads it, git does not), unless `respect_gitignore = false` switches it off.
- *A `.gitignore` match.* Delegated to real git: `git ls-files --cached --others --ignored` (tracked files count; tach never reads the index). Python files from the walk that match REFUSE. With no repository, a throwaway git directory is pointed at the highest ancestor holding a `.gitignore`.
- *What git cannot show*: a repository nested under the project, an ignore file above the repository root, git missing, or a `.git` that git cannot open (dubious ownership) REFUSE as unknown. Without the `.git` check that last case would look like "no repository" and lose `.git/info/exclude`.
- *`respect_gitignore = false`* switches off `.gitignore` and `.ignore`, not `.git/info/exclude`, which the adapter still lists.
- *Symbolic links* to a directory or to a `.py` file under a source root, which tach does not follow.
- *Source roots* are compared as paths: `src`, `src/.`, `./src//` and `././src` are one directory. A root with glob characters (`*`, `?`, `[`, `{`) is a glob in tach; the adapter does not expand it and treats the whole project as inside it, so every check above applies project-wide. tach 0.35 has no default `exclude`: `tests/`, `docs/` and `venv/` are read.
- *Overlapping source roots* REFUSE (`tach-overlapping-source-roots`, no opt-out): one root equal to or inside another (`[".", "src"]`, `["src", "src/a"]`), a glob beside another root, or a glob that can match nested directories (`**`, braces). tach walks roots in parallel and drops real findings from such a project in about a third of its runs, so the same Gate would PASS on one run and FAIL on the next.
- *`tach.domain.toml`* counts only where tach reads it: inside a source root. A file elsewhere is ignored, and one in an ignored directory refuses like any hidden source.
- *git's own environment is cleared* (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_NOSYSTEM`, ...): tach reads the repository and `~/.gitconfig` from disk, not from the environment.
- *Environments are not first-party code.* A directory named `venv`, `env` or `virtualenv` that holds `pyvenv.cfg` is exempt from the ignored-file and symlink checks (its `lib64` link is a symlink) and from the exclude-name check. A directory of any other name is not.

`allowIgnoredSources` accepts the ignore-file, nested-repository and symlink cases knowingly; `allowExcludedSources` accepts an exclude. Neither covers overlapping roots.

**One kind per import.** tach reports one kind of finding per import, in this order: layer, then forbidden, then deprecated and undeclared (`checks/internal_dependency.rs`). A Gate that selects `undeclared-dependency` alone therefore PASSES an import tach labels forbidden or layer, even if it is also undeclared. The shared adapter contract (a Gate ignores kinds it did not select) rules out refusing it, and telling the cases apart needs tach's own `depends_on` matching. To rule such imports out, select the higher kinds too. `tests/exposure.native.test.ts` pins this.

**Source roots** outside the Gate root, by `..`, an absolute path or a symlink, REFUSE (`tach-path-outside-root`).

## Blind spots that remain (tach decides, and prints a clean report)

These cannot be told from the JSON or from the configuration, so they are documented rather than refused:
- Python files under a hidden directory (`src/.legacy/`): tach never reads them and the walk skips them too, so nothing refuses.
- `root_module` is `ignore` by default: a file that belongs to no module is not checked. `utility = true` modules and imports that a `layers` ordering allows are never an undeclared dependency.
- `# tach-ignore` on an import. The `ignore-directive` rule audits directives but a needed one still silences its import.
- Imports under `if TYPE_CHECKING:` (`ignore_type_checking_imports` defaults to true), string imports and dynamic imports (`include_string_imports` defaults to false).
- Files outside `source_roots`, notebooks, and a module `layer` that no `layers` entry defines (tach raises nothing).
- `UnnecessarilyIgnoredDependency` exists in tach's diagnostic enum but tach 0.35.3 never constructs it (it is only formatted), so it cannot be produced; if a newer tach prints it, it is an unknown variant and REFUSES.

Evidence for each: `22-tach/REDPROOF_TACH_BATTLE_TEST.md`. Verified against tach 0.35.3.
