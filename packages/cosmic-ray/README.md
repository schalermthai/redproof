# @redproof/cosmic-ray

Redproof adapter for Python mutation testing with [cosmic-ray](https://github.com/sixty-north/cosmic-ray). It turns surviving mutants and the mutation score into Redproof Rules, so you can prove your Python tests really catch broken code.

Part of [Redproof](https://github.com/schalermthai/redproof). Redproof does not
just run your guardrails. It proves they can fail.

## Install

Requires Node.js 24 or later and a Python with cosmic-ray installed. CI (ci.yml and publish.yml) installs cosmic-ray 8.9.0 with pytest 9.2.0 and runs the end-to-end tests with `REDPROOF_COSMIC_RAY_REQUIRED=1`; the default local venv is 8.9.0 too. The same tests also pass on 8.3.15 (point `REDPROOF_COSMIC_RAY_PYTHON` at a venv that has cosmic-ray 8.3.15 and pytest); other versions are not tested. The adapter runs cosmic-ray through a small Python driver that uses `cosmic_ray.mutating.run_tests`, `TestOutcome` and `cosmic_ray.cli.main`; a version without them fails to start and the run REFUSES, it never passes. The flat 8.1.0 dump is refused.

```bash
npm install --save-dev @redproof/cosmic-ray redproof
python -m pip install cosmic-ray
```

## Use

Start with a working `cosmic-ray.toml` (module path, test command, timeout).

```ts
// gates/python-test-strength.ts
import { cosmicRay } from '@redproof/cosmic-ray';
import { defineGate } from 'redproof';

const adapter = cosmicRay({
  python: '.venv/bin/python',
  config: 'cosmic-ray.toml',
  rules: {
    mutantsDetected: true,
    mutationScore: { minimum: 90 },
  },
});

export default defineGate({ id: 'python-test-strength', adapter });
```

Each Check copies the Gate root into a temporary sandbox and runs `cosmic_ray.cli baseline`, `init`, `dump`, `exec`, `dump` there.
cosmic-ray rewrites source files in place, and killing it (a timeout, an abort) leaves them mutated, so it never runs on the real tree: your source files stay byte-identical on every exit path.
**One exception, by design:** environment directories (`node_modules`, `.tox`, `.nox`, and `venv`/`.venv` when they hold a `pyvenv.cfg`) are linked, not copied, so a test that writes into one (bytecode, caches, logs) writes into the real directory. Writes anywhere else in the project land in the sandbox and are discarded.
A link to the project root or to one of its ancestors is not followed. The copy skips `.git`, `__pycache__`, `.pytest_cache`, `.mypy_cache`, `.ruff_cache`, `.hypothesis` and `*.egg-info`, and links environment directories instead of copying them (a directory named `venv`, `.venv` or `env` without a `pyvenv.cfg` is a real package and is copied), so a relative test command such as `.venv/bin/python -m pytest` still works. The copy costs one pass over the project's files; over `maxCopyBytes` (default 512 MiB) or `maxCopyEntries` (default 200000) the run REFUSES `cosmic-ray-copy-too-large`.
Apart from the environment directories below, nothing in the copy leads back to your tree: a symlink that stays inside the project is rebuilt inside the sandbox, one that leaves it is copied by value, a dangling one is dropped. After `init`, every module path is resolved through the sandbox's links; one that is absolute, resolves outside the sandbox (for example through a linked `.venv`) or does not exist there REFUSES before `exec` (`cosmic-ray-module-path-escapes`).
Real-tool tests (also pinning the linked-environment exception above) check the real tree is byte-identical after PASS, FAIL, REFUSE and a timeout kill, with an absolute symlinked source directory, a source package called `env`, and a module path through a linked environment.

`timeoutMs` is one deadline for the whole run: each step gets what is left, and an exhausted deadline REFUSES `command-timeout`.
The sandbox is removed on every path. Error precedence: the check's own outcome wins. A cleanup failure demotes a PASS to REFUSE `cosmic-ray-cleanup-unavailable`; a REFUSE keeps its code and gains the leftover path in its detail; a FAIL keeps its breaches and the first one names the leftover path. If the host process itself is killed, the sandbox (up to `maxCopyBytes`) stays in the system temp directory.

## What counts as a kill

cosmic-ray records every non-zero test exit AND every signal death as `killed`, with whatever stdout it captured, and it drops stderr. An OOM-killed or `kill -9`-ed pytest therefore looks like a failed assertion, and a `unittest` failure (written to stderr) looks like a silent run. The adapter does not guess from the output. It runs cosmic-ray through a small Python driver (`python -c`, source in `src/core/driver.ts`) that replaces cosmic-ray's test runner and writes the result as the FIRST line of the recorded output, from the cosmic-ray worker process that the code under test cannot reach:

| First line | Meaning |
| --- | --- |
| `REDPROOF-EXIT 0` | tests passed: the mutant survived |
| `REDPROOF-EXIT n` (n > 0) | the runner failed with its own exit code: a kill |
| `REDPROOF-SIGNALLED n` | died by a signal, or exited 129-192 (a shell reporting one): not a kill, REFUSE |
| `REDPROOF-UNSTARTED` | the test command could not start: not a kill, REFUSE |
| `timeout` | cosmic-ray's own timeout, see below |

A `killed` result without the marker (a distributor that does not run in the driver process, an old format) is not counted: the run REFUSES. A kill is decided by the runner's exit code, never by its output, so a stderr-only reporter such as `unittest` works; stderr is also merged into the recorded output so refusal details carry it. During `baseline` anything but a pass fails the baseline, so a test command that cannot run no longer passes it. A test that kills the cosmic-ray worker itself leaves jobs without results, which also refuses; one that edits the session database is outside what the adapter can defend.

## Your tests run on the copy

The test command imports from the sandbox, not from your tree. An editable install of the project itself (`pip install -e .`, a `.pth` file pointing at `src/`) makes the tests import the real, unmutated code, so every mutant survives and a strong suite FAILS. The adapter cannot tell that from a genuinely weak suite. Put the project on the path relatively instead (`PYTHONPATH=src`, pytest's `pythonpath` setting, or run from the project root), and keep the project out of the environment's site-packages.

## Rules

| Rule | Breach |
| --- | --- |
| `cosmic-ray/mutants-detected` | one `mutant-survived` per survivor, at `file:line:column`, with the operator and changed line |
| `cosmic-ray/mutation-score` | `mutation-score-below-minimum` when killed / (killed + survived) is under `minimum`, compared in integers so exact boundaries (29 of 50 at 58%) do not breach (at least 0.000001: a minimum that rounds to 0 could never go red, so it is rejected) |

## It refuses instead of passing

cosmic-ray's own exit codes and `cr-rate` look healthy in all of these. The adapter REFUSES:

| Situation | Refusal code |
| --- | --- |
| tests fail on unmutated code (every mutant would look killed) | `cosmic-ray-baseline-failed` |
| the test command is signalled or cannot start on unmutated code | `cosmic-ray-baseline-unrunnable` |
| the test command runs past the cosmic-ray `timeout` on unmutated code | `cosmic-ray-baseline-timeout` |
| two project files share one name in the sandbox (case-insensitive temp disk) | `cosmic-ray-copy-collision` |
| the Python has no cosmic-ray, or the config cannot be loaded (exit 78) | `cosmic-ray-not-installed`, `cosmic-ray-config-invalid` |
| `init`, `exec` or `dump` exit non-zero (killed process, bad config, no module) | `cosmic-ray-producer-unsuccessful` |
| process timeout, signal, or output limit | `command-timeout`, `command-signaled`, `command-output-limit` |
| a job has no result, a mutant is `killed` without the driver's runner-failure marker (a signalled or OOM-killed test process, not an assertion), a worker failed, a test could not start, or a job was skipped (and, with `timeouts: 'refuse'`, a mutant timed out) | `cosmic-ray-incomplete` |
| more than half of the mutants timed out | `cosmic-ray-timeouts-excessive` |
| zero mutants (module excluded, nothing to mutate) | `cosmic-ray-no-mutants` |
| a dump that is not the 8.3+ format, or whose final jobs differ from the planned jobs | `cosmic-ray-report-invalid` |
| a mutated module outside the Gate root | `cosmic-ray-module-outside-root` |

## Timeouts

A mutant whose tests ran past the `timeout` is recorded as `killed` with the exact output `timeout`, which the driver writes. The driver only calls it a timeout while the test command itself is still running: a command that exited keeps its own exit code even if a child it left behind still holds the output pipe open, and the whole process group is killed after every run. If the run's own `timeoutMs` deadline (or an abort) kills cosmic-ray, the test commands still running at that moment are killed too, before the sandbox is removed.
`timeouts: 'detected'` (the default) counts such a mutant as detected, like the Stryker adapter: an infinite-loop mutant (`i += 1` becoming `i += 0`) is the textbook way a mutation is caught, and refusing it would make a perfect suite unpassable.
`timeouts: 'refuse'` refuses any run with a timed-out mutant, for projects that want every mutant to fail on an assertion.
What counts as a kill is the test command's own exit code, read by the driver, not its output. A non-zero exit of 1 to 128, or 193 and up, is a kill, silent or not. That includes a suite that crashes (a mutant that breaks an import makes pytest exit 2, which is detected like any other failure). A signal death (SIGKILL from the OOM killer, a stray `pkill`) and an exit of 129-192 (the codes a shell reports for a signal, so 137 and 143) are not kills and REFUSE the run. A wrapper that legitimately reports failure with a code in 129-192 therefore cannot be rated; wrap it so it exits 1.

Either way, if more than half of the mutants time out the run REFUSES (`cosmic-ray-timeouts-excessive`): a `timeout` that is too short makes every mutant look killed. The guard looks at the share rather than comparing `timeout` with the baseline's duration, because the adapter does not parse your TOML. When a score is breached, the timed-out mutants are listed in the breach detail; a passing result carries no detail.

## Dump size

`dump` prints every test output of every mutant through stdout, about 1-2 KiB per mutant on a small project, so the default `maxOutputBytes` of 64 MiB holds tens of thousands of mutants. A bigger dump REFUSES `command-output-limit` (never a pass); raise `maxOutputBytes`.

## Blind spots

The score covers only the modules in `module-path` minus `excluded-modules`. Filters (`cr-filter-*`) are not run by the adapter. The test command decides what "killed" means (`-x`, `-k`, `--deselect`). A 100% score does not mean untested code was mutated.
