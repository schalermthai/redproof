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
  configFile: 'stryker.config.mjs',
  rules: {
    mutantsDetected: true,
    mutationScore: { minimum: 100 },
  },
});

export default defineGate({ id: 'test-strength', adapter });
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
