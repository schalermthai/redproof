# @redproof/cosmic-ray

Redproof adapter for Python mutation testing with [cosmic-ray](https://github.com/sixty-north/cosmic-ray). It turns surviving mutants and the mutation score into Redproof Rules, so you can prove your Python tests really catch broken code.

Part of [Redproof](https://github.com/schalermthai/redproof). Redproof does not
just run your guardrails. It proves they can fail.

## Install

Requires Node.js 24 or later and a Python with cosmic-ray installed. The adapter's end-to-end tests run against cosmic-ray 8.9.0 in CI; the dump format and the init/exec/dump flow were also checked by hand on 8.3.15, 8.4.6 and 8.8.0. The flat 8.1.0 dump is refused.

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
cosmic-ray rewrites source files in place, and killing it (a timeout, an abort) leaves them mutated, so it must never run on the real tree: your files stay byte-identical on every exit path.
The copy skips `.git`, `__pycache__`, `.pytest_cache`, `.mypy_cache`, `.ruff_cache`, `.hypothesis` and `*.egg-info`, and symlinks `.venv`, `venv`, `node_modules`, `.tox` and `.nox` instead of copying them (`env` is copied: it is a common name for a real source package), so a relative test command such as `.venv/bin/python -m pytest` still works. The copy costs one pass over the project's files; over `maxCopyBytes` (default 512 MiB) the run REFUSES `cosmic-ray-copy-too-large`.
Nothing in the copy may lead back to your tree: a symlink that stays inside the project is rebuilt inside the sandbox, one that leaves it is copied by value, a dangling one is dropped. After `init`, every module path is resolved through the sandbox's links; one that is absolute, leaves the working directory, resolves outside the sandbox (for example through a linked `.venv`) or does not exist there REFUSES before `exec` (`cosmic-ray-module-path-escapes`).
Real-tool tests check the real tree is byte-identical after PASS, FAIL, REFUSE and a timeout kill, with an absolute symlinked source directory, a source package called `env`, and a module path through a linked environment.

`timeoutMs` is one deadline for the whole run: each step gets what is left, and an exhausted deadline REFUSES `command-timeout`.
The sandbox is removed on every path. Error precedence: the check's own outcome wins. A cleanup failure demotes a PASS to REFUSE `cosmic-ray-cleanup-unavailable`; a REFUSE keeps its code and gains the leftover path in its detail; a FAIL keeps its breaches. If the host process itself is killed, the sandbox (up to `maxCopyBytes`) stays in the system temp directory.

## Rules

| Rule | Breach |
| --- | --- |
| `cosmic-ray/mutants-detected` | one `mutant-survived` per survivor, at `file:line:column`, with the operator and changed line |
| `cosmic-ray/mutation-score` | `mutation-score-below-minimum` when killed / (killed + survived) is under `minimum`, compared in integers so exact boundaries (29 of 50 at 58%) do not breach (greater than 0: a minimum of 0 could never go red, so it is rejected) |

## It refuses instead of passing

cosmic-ray's own exit codes and `cr-rate` look healthy in all of these. The adapter REFUSES:

| Situation | Refusal code |
| --- | --- |
| tests fail on unmutated code (every mutant would look killed) | `cosmic-ray-baseline-failed` |
| the Python has no cosmic-ray, or the config cannot be loaded (exit 78) | `cosmic-ray-not-installed`, `cosmic-ray-config-invalid` |
| `init`, `exec` or `dump` exit non-zero (killed process, bad config, no module) | `cosmic-ray-producer-unsuccessful` |
| process timeout, signal, or output limit | `command-timeout`, `command-signaled`, `command-output-limit` |
| a job has no result, a worker failed, a test could not start, or a job was skipped (and, with `timeouts: 'refuse'`, a mutant timed out) | `cosmic-ray-incomplete` |
| more than half of the mutants timed out | `cosmic-ray-timeouts-excessive` |
| zero mutants (module excluded, nothing to mutate) | `cosmic-ray-no-mutants` |
| a dump that is not the 8.3+ format | `cosmic-ray-report-invalid` |
| a mutated module outside the Gate root | `cosmic-ray-module-outside-root` |

## Timeouts

cosmic-ray records a mutant whose tests ran past its `timeout` as `killed` with the output `timeout`; the adapter tells them apart by that output.
`timeouts: 'detected'` (the default) counts such a mutant as detected, like the Stryker adapter: an infinite-loop mutant (`i += 1` becoming `i += 0`) is the textbook way a mutation is caught, and refusing it would make a perfect suite unpassable.
`timeouts: 'refuse'` refuses any run with a timed-out mutant, for projects that want every mutant to fail on an assertion.
Either way, if more than half of the mutants time out the run REFUSES (`cosmic-ray-timeouts-excessive`): a `timeout` that is too short makes every mutant look killed. The guard looks at the share rather than comparing `timeout` with the baseline's duration, because the adapter does not parse your TOML. When a score is breached, the timed-out mutants are listed in the breach detail; a passing result carries no detail.

## Dump size

`dump` prints every test output of every mutant through stdout, about 1-2 KiB per mutant on a small project, so the default `maxOutputBytes` of 64 MiB holds tens of thousands of mutants. A bigger dump REFUSES `command-output-limit` (never a pass); raise `maxOutputBytes`.

## Blind spots

The score covers only the modules in `module-path` minus `excluded-modules`. Filters (`cr-filter-*`) are not run by the adapter. The test command decides what "killed" means (`-x`, `-k`, `--deselect`). A 100% score does not mean untested code was mutated.
