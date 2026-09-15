# @redproof/eslint

Redproof adapter for ESLint. It turns ESLint rules into Redproof Rules, so you can prove each one really fails when it should.

Part of [Redproof](https://github.com/schalermthai/redproof). Redproof does not
just run your guardrails. It proves they can fail.

## Install

```bash
npm install --save-dev @redproof/eslint redproof eslint
```

## Use

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

Then run:

```bash
npx redproof check   # do the rules hold right now?
npx redproof prove   # can each rule actually fail?
```

## Documentation

See the [Redproof documentation](https://github.com/schalermthai/redproof#readme).

## License

Apache-2.0
