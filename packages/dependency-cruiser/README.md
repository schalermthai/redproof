# @redproof/dependency-cruiser

Redproof adapter for dependency-cruiser. It turns your architecture rules into Redproof Rules, so you can prove each boundary really fails when it is crossed.

Part of [Redproof](https://github.com/schalermthai/redproof). Redproof does not
just run your guardrails. It proves they can fail.

## Install

Requires Node.js 24 or later and dependency-cruiser 18 or later.

```bash
npm install --save-dev @redproof/dependency-cruiser redproof dependency-cruiser
```

## Use

Start with a [Redproof configuration](https://github.com/schalermthai/redproof#install)
and a working `.dependency-cruiser.cjs` defining `domain-no-infrastructure`.
The proof below assumes `src/domain/order.js` and `src/infrastructure/db.js`
exist, and that importing the latter from the former violates that rule.

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

```bash
npx redproof check gates/architecture.ts
npx redproof prove gates/architecture.ts
```

The RED proof adds a forbidden import; the GREEN proof checks the healthy
architecture. Add a targeted proof for each additional boundary you select.

## Supported Rules

Select rule names from your dependency-cruiser configuration, not from a fixed
Redproof catalog. For example:

| Selection inside `rules` | Generated Rule ID | What must hold |
|---|---|---|
| `domainNoInfrastructure: 'domain-no-infrastructure'` | `dependency-cruiser/domain-no-infrastructure` | The boundary defined by that named rule. |
| `allowedOnly: 'not-in-allowed'` | `dependency-cruiser/not-in-allowed` | Dependencies comply with the configured `allowed` rules. |
| `<alias>: '<configured-rule-name>'` | `dependency-cruiser/<configured-rule-name>` | No new violations of the selected rule outside any accepted baseline. |

The alias gives you a reference such as `adapter.rules.domainNoInfrastructure`.
Rule names and boundary definitions stay in dependency-cruiser's configuration;
selecting them here does not create or enable them. See a
[working configuration](https://github.com/schalermthai/redproof/blob/main/fixtures/dependency-cruiser-project/.dependency-cruiser.cjs).

## Features and limits

One dependency-cruiser run can report breaches across several selected Rules.
Unlike one command-exit verdict, these can each have their own targeted proof.

`configFile`, `knownViolationsFile`, and each entry of `files` must be non-empty
relative paths. An empty or absolute value throws when the Gate file loads.
That check rejects an absolute path only. It does not reject a `..` segment, so
`files` is not confined to the Gate root.

Set `knownViolationsFile` when the project maintains a dependency-cruiser
baseline. Matching known violations are ignored; new violations still breach
their selected Redproof Rules. Checks run without dependency-cruiser caching so
proof mutations cannot reuse stale architecture results.

Every selected dependency-cruiser Rule must also be active. A Rule configured
with severity `ignore` produces REFUSE, because Redproof cannot honestly claim
that an architecture boundary holds when dependency-cruiser has disabled it.

The `not-in-allowed` Rule takes its severity from the `allowedSeverity` option
beside the `allowed` block, not from a severity inside it. `allowedSeverity:
'ignore'` deletes the whole `allowed` block before the cruise, so that Rule
produces REFUSE too.

A baseline weakens the Gate on purpose. Keep a RED proof that plants a new
violation, so the Gate is known to still fail. A baseline that grows with every
new violation guards nothing and still reports PASS. A baseline file that is not
a JSON array produces REFUSE, never a pass.

## Documentation

See [all built-in Adapters and the comparison with Command Checks](https://github.com/schalermthai/redproof/blob/main/docs/built-in-adapters.md).

## License

Apache-2.0
