# @redproof/stryker

Redproof adapter for Stryker mutation testing. It turns mutation score and undetected mutants into Redproof Rules, so you can prove your tests really catch broken code.

Part of [Redproof](https://github.com/schalermthai/redproof). Redproof does not
just run your guardrails. It proves they can fail.

## Install

Requires Node.js 24 or later and Stryker 10 or later. Install any test-runner
plugins required by your Stryker configuration too.

```bash
npm install --save-dev @redproof/stryker redproof @stryker-mutator/core
```

## Use

Start with a working `stryker.config.mjs` and a
[Redproof configuration](https://github.com/schalermthai/redproof#install).

```ts
// gates/test-strength.ts
import { stryker } from '@redproof/stryker';
import { defineGate } from 'redproof';

const adapter = stryker({
  configFile: 'stryker.config.mjs',
  rules: {
    mutantsDetected: true,
    mutationScore: { minimum: 100 },
  },
});

export default defineGate({ id: 'test-strength', adapter });
```

```bash
npx redproof check gates/test-strength.ts
```

This example checks test strength; it does not include proofs. Export a
`defineProofs` suite before running `npx redproof prove gates/test-strength.ts`.
A RED proof can weaken a test so Stryker finds an undetected mutant. See the
[test-strength proof example](https://github.com/schalermthai/redproof/blob/main/fixtures/stryker-project/gates/test-strength.ts).

## Supported Rules

| Selection inside `rules` | Rule ID | What must hold |
|---|---|---|
| `mutantsDetected: true` | `stryker/mutants-detected` | Every valid mutant is detected by the tests. |
| `noNewUndetectedMutants: { acceptedMutantsFile: 'accepted-mutants.json' }` | `stryker/no-new-undetected-mutants` | No undetected mutants exist outside the accepted baseline. |
| `mutationScore: { minimum: 80 }` | `stryker/mutation-score` | The mutation score is at least the chosen percentage (0–100). |

## Features

- Checks selected mutation policies separately, with targeted Rule breaches and proofs.
- Matches baseline mutants by identity, not just survivor count; a new survivor
  still breaches when the total count stays the same.
- Refuses invalid or stale baseline evidence and Stryker execution failures.
- Keeps Stryker logs out of Redproof's reporting stream.

## Working directory

Set `cwd: 'packages/parser'` to run Stryker from a package within the Gate root.

`cwd` is relative to the Gate root and cannot resolve outside it, including
through a symbolic link. `configFile`, `acceptedMutantsFile`, and Stryker's own
relative paths are resolved from that working directory. A `cwd` that does not
exist is reported as `stryker-unavailable`. `cwd`, `configFile`, and
`acceptedMutantsFile` must be non-empty relative paths. An empty or absolute
value throws when the Gate file loads.

## Accepted-mutant baseline

If a mature project intentionally carries surviving or uncovered mutants, use
an accepted-mutant baseline instead of weakening the score until unrelated
regressions fit under it. Select `noNewUndetectedMutants` in place of
`mutantsDetected`. With both selected, every accepted mutant still breaches
`mutantsDetected`.

```ts
import { stryker } from '@redproof/stryker';

const adapter = stryker({
  configFile: 'stryker.config.mjs',
  rules: {
    noNewUndetectedMutants: {
      acceptedMutantsFile: 'accepted-mutants.json',
    },
  },
});
```

```json
[
  {
    "fileName": "src/parser.ts",
    "mutatorName": "EqualityOperator",
    "replacement": ">",
    "location": {
      "start": { "line": 4, "column": 10 },
      "end": { "line": 4, "column": 12 }
    },
    "reason": "Equivalent for the supported input domain."
  }
]
```

The baseline is a JSON array. Redproof resolves the file from the working
directory and refuses a path that leaves the Gate root. Each `fileName` is
relative to the working directory. The identity of a mutant is its file, its
full start and end location, its mutator, and its replacement. This is the key
Stryker uses in `stryker-incremental.json`, so you can copy an entry from that
report or from the JSON reporter output. A different undetected mutant breaches
the Rule even when the survivor count is unchanged. The optional `reason` is
documentation and does not take part in matching.

Three cases REFUSE. A malformed, duplicate, or escaping entry refuses before
Stryker runs. An accepted mutant that the tests now detect refuses, because the
baseline would pass that mutant if it survived again. Remove the entry. An
undetected mutant without a stable identity refuses, and no other Rule is
evaluated in that run. The `replacement` text comes from Stryker's code
generator, so a Stryker upgrade can change it and make entries stale.

## Reporting

The Adapter disables Stryker's reporters and logs while it runs. This keeps
Redproof's text, JSON, and SARIF output as the only reporting stream. A Stryker
failure is returned as REFUSE detail; rerun Stryker directly when you need its
native debug log or mutation report. Mutant and baseline locations are reported
relative to the Gate root, even when Stryker runs from a nested `cwd`.

## Documentation

See [all built-in Adapters and the comparison with Command Checks](https://github.com/schalermthai/redproof/blob/main/docs/built-in-adapters.md).

## License

Apache-2.0
