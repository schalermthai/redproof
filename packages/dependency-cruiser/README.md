# @redproof/dependency-cruiser

Redproof adapter for dependency-cruiser. It turns your architecture rules into Redproof Rules, so you can prove each boundary really fails when it is crossed.

Part of [Redproof](https://github.com/schalermthai/redproof). Redproof does not
just run your guardrails. It proves they can fail.

## Install

```bash
npm install --save-dev @redproof/dependency-cruiser redproof dependency-cruiser
```

## Use

```ts
// gates/architecture.ts
import { dependencyCruiser } from '@redproof/dependency-cruiser';
import { defineGate, defineProofs, mutate, proof } from 'redproof';

const adapter = dependencyCruiser({
  configFile: '.dependency-cruiser.cjs',
  files: ['src'],
  rules: {
    domainNoInfrastructure: 'domain-no-infrastructure',
  },
});

const gate = defineGate({ id: 'architecture', adapter });

export const proofs = defineProofs(gate, [
  proof.red(
    adapter.rules.domainNoInfrastructure,
    'detects domain importing infrastructure',
    mutate.appendText('src/domain/order.js', "\nimport '../infrastructure/db.js';\n"),
  ),
  proof.green('accepts valid architecture'),
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
