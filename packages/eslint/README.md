# @redproof/eslint

Redproof adapter for ESLint. It turns ESLint rules into Redproof Rules, so you can prove each one really fails when it should.

Part of [Redproof](https://github.com/schalermthai/redproof). Redproof does not
just run your guardrails. It proves they can fail.

## Install

Requires Node.js 24 or later and ESLint 9 or later.

```bash
npm install --save-dev @redproof/eslint redproof eslint
```

## Use

Start with a [Redproof configuration](https://github.com/schalermthai/redproof#install)
and an ESLint configuration for your source files. This example assumes
`src/clean.js` exists and passes ESLint. For setup from scratch, follow the
[ESLint walkthrough](https://github.com/schalermthai/redproof/blob/main/docs/built-in-adapters.md#eslint-your-first-adapter-gate).

```ts
// gates/eslint.ts
import { eslint } from '@redproof/eslint';
import { defineGate, defineProofs, mutate, proof } from 'redproof';

const adapter = eslint({
  files: ['src/**/*.js'],
  rules: {
    noConsole: 'no-console',
  },
});

const gate = defineGate({ id: 'eslint', adapter });

export const proofs = defineProofs(gate, [
  proof.red(
    adapter.rules.noConsole,
    'detects console usage',
    mutate.appendText('src/clean.js', '\nconsole.log(1);\n'),
  ),
  proof.green('accepts clean source'),
]);

export default gate;
```

```bash
npx redproof check gates/eslint.ts
npx redproof prove gates/eslint.ts
```

The RED proof adds a console call and expects a breach of `noConsole`; the GREEN
proof checks clean source. Add a targeted proof for each additional Rule you select.

## Supported Rules

There is no fixed Redproof catalog: select ESLint rule IDs available in your
project, including rules supplied by configured plugins. Browse the
[official ESLint Rules Reference](https://eslint.org/docs/latest/rules/) for core
rule IDs and options; plugin rules are documented by their respective plugins.
The table below shows examples, not the full supported list:

| Selection inside `rules` | Generated Rule ID | What must hold |
|---|---|---|
| `noConsole: 'no-console'` | `eslint/no-console` | No console calls disallowed by the rule's options. |
| `strictEquality: 'eqeqeq'` | `eslint/eqeqeq` | Equality comparisons follow ESLint's `eqeqeq` policy. |
| `<alias>: '<eslint-rule-id>'` | `eslint/<eslint-rule-id>` | The selected ESLint rule has no findings. |

The alias is your local property name, such as `adapter.rules.noConsole`.
The Adapter enables selected rules at error severity; your ESLint configuration
supplies their options, parsers, and plugins. Unselected findings do not breach.

### What about presets?

Keep presets in your `eslint.config.*`; the Adapter loads that configuration.
There is no Adapter option to select a whole preset or automatically turn all
its enabled rules into Redproof Rules. You select individual rule IDs in `rules`.

For example, if your preset enables 100 rules and you select two here, only
findings for those two can breach this Gate. **A PASS does not mean the entire
ESLint configuration passed.** It means the selected Rules held in the inspected
scope.

To require your full ESLint run to succeed, use a
[Command Check](https://github.com/schalermthai/redproof/blob/main/docs/commands.md#exit-codes-decide-the-verdict).
You can keep that alongside an Adapter Gate with targeted proofs for the rules
you most want to protect.

## Features and limits

A configured ESLint finding becomes a Breach of the Redproof Rule that adopted
it. Fatal parsing or execution problems become REFUSE, not fake Rule breaches.

An adopted Rule cannot be suppressed in the source. A finding that ESLint
reports as suppressed by `/* eslint-disable */` still breaches the Redproof
Rule that adopted it. The ESLint Adapter has no baseline.

Name a path in `files` and ESLint must read it. A configured `ignores` pattern
that excludes that path becomes REFUSE, not PASS. A glob in `files` keeps your
`ignores` patterns, so name the path when you need Redproof to prove that
ESLint read it.

Each entry of `files` must be a non-empty relative path. An empty or absolute
entry throws when the Gate file loads. That check rejects an absolute path
only. It does not reject a `..` segment, so `files` is not confined to the
Gate root.

## Documentation

See [all built-in Adapters and the comparison with Command Checks](https://github.com/schalermthai/redproof/blob/main/docs/built-in-adapters.md).

## License

Apache-2.0
