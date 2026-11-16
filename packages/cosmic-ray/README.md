# @redproof/cosmic-ray

Redproof adapter for Python mutation testing with [cosmic-ray](https://github.com/sixty-north/cosmic-ray). It turns surviving mutants and the mutation score into Redproof Rules, so you can prove your Python tests really catch broken code.

Part of [Redproof](https://github.com/schalermthai/redproof). Redproof does not
just run your guardrails. It proves they can fail.

## Install

Requires Node.js 24 or later, and a Python with cosmic-ray 8.3.15 or later (older formats are refused).

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

Each Check runs, in a private session directory: `cosmic_ray.cli baseline`, `init`, `exec`, `dump`.

## Rules

| Rule | Breach |
| --- | --- |
| `cosmic-ray/mutants-detected` | one `mutant-survived` per survivor, at `file:line:column`, with the operator and changed line |
| `cosmic-ray/mutation-score` | `mutation-score-below-minimum` when killed / (killed + survived) is under `minimum` |

## It refuses instead of passing

cosmic-ray's own exit codes and `cr-rate` look healthy in all of these. The adapter REFUSES:

| Situation | Refusal code |
| --- | --- |
| tests fail on unmutated code (every mutant would look killed) | `cosmic-ray-baseline-failed` |
| `init`, `exec` or `dump` exit non-zero (killed process, bad config, no module) | `cosmic-ray-producer-unsuccessful` |
| process timeout, signal, or output limit | `command-timeout`, `command-signaled`, `command-output-limit` |
| a job has no result, a mutant timed out, a worker failed, a test could not start, or a job was skipped | `cosmic-ray-incomplete` |
| zero mutants (module excluded, nothing to mutate) | `cosmic-ray-no-mutants` |
| a dump that is not the 8.3+ format | `cosmic-ray-report-invalid` |
| a mutated module outside the Gate root | `cosmic-ray-module-outside-root` |

A mutant that hits cosmic-ray's `timeout` is not counted as detected (Stryker's behaviour): cosmic-ray records it as killed with the output `timeout`, so it is told apart by that output.

## Blind spots

The score covers only the modules in `module-path` minus `excluded-modules`. Filters (`cr-filter-*`) are not run by the adapter. The test command decides what "killed" means (`-x`, `-k`, `--deselect`). A 100% score does not mean untested code was mutated.
