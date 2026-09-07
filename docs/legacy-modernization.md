# Legacy modernization

Modernization replaces parts of a system that still has to work. The risk is not that the new code is wrong. The risk is that you do not find out.

You already know the usual answer. Write tests. Add contract checks. Watch the dashboards. All of that is good, and all of it shares one weakness. A green result and a broken safeguard look exactly the same.

Redproof asks one question about every safeguard you rely on:

> **If this safeguard stopped detecting a migration regression, would we know?**

This guide shows how to apply that question to a strangler-style modernization.

## The shape of the work

```text
legacy system
   ↓
identify invariants
   ↓
turn invariants into Gates
   ↓
prove the Gates can detect regressions
   ↓
modernize behind those Gates
```

An invariant is something that must stay true while you change the system. A Gate is that invariant, written as code that runs. A proof is evidence that the Gate can fail when the invariant is broken.

The order matters. You prove the Gate before you trust it, not after the migration goes wrong.

## Gates for a strangler migration

A strangler migration replaces one piece at a time. The old and the new system run together for months. Six kinds of Gate cover most of that period.

```text
Gate: behavior-compatibility
  R1 new implementation returns the same response for known cases
  R2 important error cases stay compatible

Gate: database-contract
  R1 required columns remain readable
  R2 migration does not break legacy writes

Gate: API-contract
  R1 response schema is unchanged
  R2 status codes remain compatible

Gate: architecture
  R1 new domain code must not depend on legacy infrastructure
  R2 new modules must not introduce reverse dependencies

Gate: data-migration
  R1 migrated record counts reconcile
  R2 key fields preserve their values

Gate: operations
  R1 health check still detects dependency failure
  R2 alerting still fires for the critical failure mode
```

Each Rule then gets a proof. Ask the same question of each one. If this Rule stopped detecting its failure, would we know?

## Characterization tests

A characterization test records what the legacy system does today. It does not say the behavior is correct. It says the behavior is this.

Teams often start here:

```text
legacy behavior
   ↓
characterization tests
   ↓
green
```

That is useful. It is also incomplete. Green tells you the tests ran. It does not tell you the tests can fail.

Redproof completes the picture. It changes the behavior the test is supposed to protect:

```text
change legacy output
   ↓
run characterization test
   ↓
must go RED
```

If the test stays green, your safety net was never protecting that behavior.

The two ideas fit together directly:

```text
characterization test
  establishes current behavior

Redproof
  establishes that the characterization test can detect a change
```

Here is that pair as a Gate. The characterization suite runs through the testing Adapter. The RED proof changes the legacy output the suite claims to protect.

```ts
// gates/characterization.ts

import { report, runner, testing } from '@redproof/testing';
import { defineGate, defineProofs, locate, mutate, proof } from 'redproof';

const adapter = testing({
  runner: runner.command({
    command: 'npm',
    args: ({ reportFile }) => ['run', 'test:characterization', '--', `--reporter=junit`, `--outputFile=${reportFile}`],
  }),

  report: report.junitXml(),

  rules: {
    testsPass: true,
    noSkippedTests: true,
  },
});

const gate = defineGate({
  id: 'characterization',
  adapter,
});

export const proofs = defineProofs(gate, [
  proof.red(
    adapter.rules.testsPass,
    'detects a change in legacy pricing output',
    mutate.replaceText(
      locate.text({
        files: 'legacy/pricing/discount.js',
        find: 'const RATE = 0.15;',
      }),
      'const RATE = 0.16;',
    ),
  ),

  proof.red(
    adapter.rules.noSkippedTests,
    'detects a skipped characterization test',
    mutate.replaceAllText(
      { files: 'test/characterization/pricing.test.js', find: 'test(' },
      'test.skip(',
    ),
  ),

  proof.green('accepts the recorded legacy behavior'),
]);

export default gate;
```

The second proof matters as much as the first. A skipped test is the most common way a safety net stops working. Nobody deletes the test. Somebody skips it during a bad week, and it never comes back.

## Migration seams

A seam is the boundary where old meets new. Seams are where compatibility breaks, so they are where Gates earn the most.

Imagine you start here:

```text
Legacy App
   ↓
Legacy DB
```

and you move to this:

```text
Legacy App ──┐
             ├── Compatibility Layer ── New Service
New App ─────┘
```

The compatibility layer is new code that both sides depend on. Write a Gate for the contract it must hold:

```text
Gate: customer-read-contract

Rules:
  R1 legacy and new read paths return equivalent customer identity
  R2 missing customer remains 404
  R3 malformed data does not become a successful response
```

Then each Rule gets a RED proof. For R2 the proof reads like this:

```text
plant state:
  make compatibility layer return 200 for missing customer

run real contract check

expect:
  FAIL
  breach R2
```

That is a stronger claim than "our contract tests currently pass". It says the contract check can see this specific failure.

Here is R2 as code. The Check runs the real contract suite. The mutation plants the exact wrong behavior in the compatibility layer.

```ts
// gates/customer-read-contract.ts

import { command } from 'redproof/command';
import {
  defineGate,
  defineProofs,
  defineRules,
  locate,
  mutate,
  proof,
} from 'redproof';

const rules = defineRules({
  identityEquivalent: {
    id: 'customer/identity-equivalent',
    description: 'Legacy and new read paths return equivalent customer identity.',
  },

  missingIsNotFound: {
    id: 'customer/missing-is-404',
    description: 'A missing customer remains a 404 response.',
  },

  malformedIsNotSuccess: {
    id: 'customer/malformed-is-not-success',
    description: 'Malformed data does not become a successful response.',
  },
});

const gate = defineGate({
  id: 'customer-read-contract',
  rules,

  check: command({
    rule: rules.identityEquivalent,
    command: 'npm',
    args: ['run', 'contract:customer-read'],
    timeoutMs: 120_000,
    exitCodes: {
      pass: [0],
      breach: [1],
    },
  }),
});

export const proofs = defineProofs(gate, [
  proof.red(
    rules.missingIsNotFound,
    'detects a missing customer answered with 200',
    mutate.replaceText(
      locate.text({
        files: 'compat/customer-read.ts',
        find: 'return notFound();',
      }),
      'return ok({ id: request.id });',
    ),
  ),

  proof.green('accepts the current compatibility layer'),
]);

export default gate;
```

One point about the Check above. It uses `exitCodes` with an explicit policy. Exit code 1 means the contract suite found a violation. Any other non-zero code means the suite could not run. Redproof reports that as REFUSE, not as a passing Gate and not as a breach. A contract suite that fails to start must never look like a contract suite that passed.

For a Gate whose Rules map to separate suites, one `command()` per Rule is clearer. Use `commands()` to run them as one Check:

```ts
import { commands } from 'redproof/command';

const check = commands({
  entries: [
    { rule: rules.identityEquivalent, command: 'npm', args: ['run', 'contract:identity'] },
    { rule: rules.missingIsNotFound, command: 'npm', args: ['run', 'contract:missing'] },
    { rule: rules.malformedIsNotSuccess, command: 'npm', args: ['run', 'contract:malformed'] },
  ],
});
```

Sequential is the default and it stops at the first REFUSE. That is the safe order for a contract Gate. If one suite could not run, the Gate has no complete answer, so it should stop rather than report a partial result.

## Milestones

Redproof is most useful just before you replace something. At that moment, ask two questions.

**First question.** What must remain true after this replacement?

Those answers become Gates.

**Second question.** Can every important Gate demonstrably detect its own failure?

Those answers become proofs.

The result is a safety envelope around the work:

```text
                    Modernization work
                           │
        ┌──────────────────┼───────────────────┐
        │                  │                   │
   behavior Gate      contract Gate      architecture Gate
        │                  │                   │
      proofs             proofs              proofs
```

## What Redproof does not prove

This limitation is important, so state it plainly.

Redproof does not prove that the old and the new system are equivalent.

It proves that the Gate you chose to establish equivalence can actually detect a violation.

Two ways to say it:

```text
bad framing:
  Redproof proves my modernization is safe.

better framing:
  These Gates define the safety properties of the modernization.
  Redproof proves those Gates can detect the failures they claim to guard.
```

The Gates are still your judgment. If you pick the wrong invariants, Redproof will faithfully prove that your wrong Gates work. Choosing what must remain true is human work. Redproof only removes the second failure, where a Gate you trust has quietly stopped working.

## A recommended sequence

1. Characterize the legacy behavior that matters.
2. Identify contracts and invariants at system boundaries.
3. Turn those into repeatable Gates.
4. Red-proof each Gate before you trust it.
5. Modernize one seam at a time.
6. Keep the same Gates running against the evolving system.
7. Add new architecture Gates. They stop the new system from recreating the legacy coupling.

Step 7 is easy to skip and expensive to skip. A modernization that rebuilds the old tangle in new files has bought nothing.

## Both directions

Redproof protects two directions at once.

```text
preserve what must not change
+
prevent what must not come back
```

The first direction is compatibility. It keeps the old promise:

```text
Legacy preservation:
  API response must remain compatible
```

The second direction is architecture. It keeps the new boundary:

```text
Modernization direction:
  new domain must not import legacy database code
```

The second direction fits the dependency Adapter well. Keep the boundary rules in your dependency-cruiser configuration. Select the ones you want to prove:

```ts
// gates/architecture.ts

import { dependencyCruiser } from '@redproof/dependency-cruiser';
import { defineGate, defineProofs, mutate, proof } from 'redproof';

const adapter = dependencyCruiser({
  configFile: '.dependency-cruiser.cjs',
  files: ['src'],
  rules: {
    domainNoLegacyDb: 'domain-no-legacy-db',
    noReverseDependency: 'no-reverse-dependency',
  },
});

const gate = defineGate({
  id: 'architecture',
  adapter,
});

export const proofs = defineProofs(gate, [
  proof.red(
    adapter.rules.domainNoLegacyDb,
    'detects new domain code importing the legacy database',
    mutate.appendText(
      'src/domain/customer.ts',
      "\nimport '../../legacy/db/connection.js';\n",
    ),
  ),

  proof.red(
    adapter.rules.noReverseDependency,
    'detects a new module imported from legacy code',
    mutate.appendText(
      'legacy/billing/invoice.js',
      "\nimport '../../src/domain/customer.ts';\n",
    ),
  ),

  proof.green('accepts the current module boundaries'),
]);

export default gate;
```

Together, the two directions cover the whole strangler program. One set of Gates says the old promise still holds. The other set says the new structure has not decayed. Both sets carry proof that they can fail.

## Next

- **[Composing Redproof](composition.md)** for authoring Rules, Checks, Proofs, Mutations, and Adapters
- **[Built-in integrations](adapters.md)** for the testing, ESLint, dependency-cruiser, and Stryker Adapters
- **[Execution isolation](tutorials/execution-isolation.md)** for running proof mutations against copied workspaces
