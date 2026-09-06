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

Then run:

```bash
npx redproof check   # do the rules hold right now?
npx redproof prove   # can each rule actually fail?
```

## Documentation

See the [Redproof documentation](https://github.com/schalermthai/redproof#readme).

## License

Apache-2.0
