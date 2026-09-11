# @redproof/stryker

Redproof adapter for Stryker mutation testing. It turns mutation score and undetected mutants into Redproof Rules, so you can prove your tests really catch broken code.

Part of [Redproof](https://github.com/schalermthai/redproof). Redproof does not
just run your guardrails. It proves they can fail.

## Install

```bash
npm install --save-dev @redproof/stryker redproof @stryker-mutator/core
```

## Use

```ts
// gates/test-strength.ts
import { stryker } from '@redproof/stryker';
import { defineGate } from 'redproof';

const adapter = stryker({
  // Optional: run Stryker from a package inside the Gate root.
  cwd: 'packages/parser',
  configFile: 'stryker.config.mjs',
  rules: {
    mutantsDetected: true,
    mutationScore: { minimum: 100 },
  },
});

export default defineGate({ id: 'test-strength', adapter });
```

`cwd` is relative to the Gate root and cannot resolve outside it, including
through a symbolic link. `configFile`, `acceptedMutantsFile`, and Stryker's own
relative paths are resolved from that working directory. A `cwd` that does not
exist is reported as `stryker-unavailable`.

If a mature project intentionally carries surviving or uncovered mutants, use
an accepted-mutant baseline instead of weakening the score until unrelated
regressions fit under it. Select `noNewUndetectedMutants` in place of
`mutantsDetected`. With both selected, every accepted mutant still breaches
`mutantsDetected`.

```ts
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

The Adapter disables Stryker's reporters and logs while it runs. This keeps
Redproof's text, JSON, and SARIF output as the only reporting stream. A Stryker
failure is returned as REFUSE detail; rerun Stryker directly when you need its
native debug log or mutation report. Mutant and baseline locations are reported
relative to the Gate root, even when Stryker runs from a nested `cwd`.

Then run:

```bash
npx redproof check   # do the rules hold right now?
npx redproof prove   # can each rule actually fail?
```

## Documentation

See the [Redproof documentation](https://github.com/schalermthai/redproof#readme).

## License

Apache-2.0
