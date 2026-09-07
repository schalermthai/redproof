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
through a symbolic link. `configFile` and Stryker's own relative paths are
resolved from that working directory.

Then run:

```bash
npx redproof check   # do the rules hold right now?
npx redproof prove   # can each rule actually fail?
```

## Documentation

See the [Redproof documentation](https://github.com/schalermthai/redproof#readme).

## License

Apache-2.0
