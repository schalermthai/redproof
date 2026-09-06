# Redproof

> **Don't just run your guardrails. Prove they can fail.**

Redproof verifies the automated guardrails you already rely on: tests, linters, architecture rules, dependency rules, mutation testing, and custom checks.

## The question Redproof asks

> **If this guardrail stopped detecting the problem tomorrow, would we know?**

When a check goes green, it tells you the current code passed, but can you trust it?

Redproof goes further by deliberately planting a controlled violation, running the same check, and confirming that the expected rule is detected.

## The idea

Imagine this architecture Gate:

```text
Gate: architecture

Rules:
  R1 domain must not import infrastructure
  R2 application must not import adapters

Check:
  inspect the repository and evaluate the architecture rules

Proof R1:
  introduce domain -> infrastructure import
  run the same Check
  expect Gate FAIL

Proof R2:
  introduce application -> adapter import
  run the same Check
  expect Gate FAIL
```

A **Gate** is a guardrail. It has one or more **Rules** and one **Check** that evaluates them.

A **Proof** deliberately violates a Rule and confirms that the same Check detects it.

If a proof targets R1 but the Gate only fails because of R2, R1 is not proven.

## A small Gate

Here is a simple Gate with no external tools.

The policy is:

> TypeScript source files must not contain TODO comments.

```ts
// gates/no-todo.ts

import {
  breach,
  counting,
  defineGate,
  defineProofs,
  defineRules,
  mutate,
  proof,
  result,
  text,
} from 'redproof';

const rules = defineRules({
  noTodo: {
    id: 'source/no-todo',
    description: 'Source files must not contain TODO comments.',
  },
});

const gate = defineGate({
  id: 'no-todo',
  rules,

  check: {
    description: 'scan TypeScript source files for TODO comments',
    counting: counting.supported,

    async run(ctx) {
      const found = await text.find(ctx, {
        files: 'src/**/*.ts',
        find: /\bTODO\b/g,
      });
      
      return result.fromBreaches(
        found.scan,
        found.matches.map(match =>
          breach(rules.noTodo, {
            code: 'todo-found',
            message: 'TODO comment found.',
            location: match.location,
          }),
        ),
      );
    },
  },
});

export const proofs = defineProofs(gate, [
  proof.red(
    rules.noTodo,
    'detects a TODO comment',
    mutate.appendText(
      'src/example.ts',
      '\n// TODO: proof mutation\n',
    ),
  ),

  proof.green('accepts clean source'),
]);

export default gate;
```

See what the Gate defines:

```bash
redproof describe gates/no-todo.ts
```

```text
Gate: no-todo

Rules:
  R1 Source files must not contain TODO comments.

Check:
  scan TypeScript source files for TODO comments

Proof R1:
  detects a TODO comment
  mutation: append text to src/example.ts
  run the same Check
  expect Gate FAIL

Proof GREEN:
  accepts clean source
  run the same Check
  expect Gate PASS
```

## Run it

Check the current project:

```bash
redproof check
```

When the Gate holds:

```text
 ✓ gates/no-todo.ts (1 rule) 8ms

 Gates     1 passed (1)
 Rules     1 held (1)
 Duration  8ms
```

If the project contains a TODO:

```text
 ❯ gates/no-todo.ts (1 rule | 1 breached | 1 breach) 9ms
   ❯ source/no-todo
     × 1 breach


 FAIL  gates/no-todo.ts > source/no-todo

 ❯ src/example.ts:8:1

   TODO comment found.

     8| // TODO: remove temporary workaround
      | ^

 Gates      1 failed (1)
 Rules      1 breached (1)
 Breaches   1
```

Now prove that the Gate itself works:

```bash
redproof prove
```

```text
✓ no-todo / detects a TODO comment expected=red actual=fail
✓ no-todo / accepts clean source expected=green actual=pass
```

The RED proof temporarily adds a TODO, runs the real Check, confirms `source/no-todo` was breached, then restores the workspace.

The GREEN proof confirms that clean source passes.

Redproof also supports **REFUSE** when a Check cannot make a trustworthy PASS or FAIL decision.

```text
PASS     the Gate holds
FAIL     one or more Rules were breached
REFUSE   the Check could not decide safely
```

## Built-in integrations

You do not need to build every Gate yourself.

- **[`@redproof/testing`](docs/adapters.md#testing)** — test suites, skipped tests, TODO tests; supports Jest-compatible JSON and JUnit XML
- **[`@redproof/eslint`](docs/adapters.md#eslint)** — selected ESLint rules as Redproof Rules
- **[`@redproof/dependency-cruiser`](docs/adapters.md#dependency-cruiser)** — architecture and dependency boundaries
- **[`@redproof/stryker`](docs/adapters.md#stryker)** — mutation detection and mutation-score policies

See **[Built-in integrations](docs/adapters.md)** for examples.

## Build your own

Redproof is designed to be composed when an existing integration does not fit your guardrail.

See **[Composing Redproof](docs/composition.md)** to create your own Gates, Rules, Checks, Proofs, Mutations, and Adapters.

For execution isolation, machine-readable reports, VS Code, and other workflows, see **[Tutorials](docs/tutorials/README.md)**.

## Install

Install Redproof:

```bash
npm install --save-dev redproof
```

Install any integrations you need:

```bash
npm install --save-dev @redproof/testing
npm install --save-dev @redproof/eslint
npm install --save-dev @redproof/dependency-cruiser
npm install --save-dev @redproof/stryker
```

Create `redproof.config.ts`:

```ts
import { defineConfig } from 'redproof';

export default defineConfig({
  root: '.',
  gatesRoot: 'gates/**/*.ts',
  refusalExit: 2,
});
```

A typical project:

```text
my-project/
├── redproof.config.ts
├── gates/
│   ├── tests.ts
│   ├── eslint.ts
│   └── architecture.ts
├── src/
└── package.json
```

Useful scripts:

```json
{
  "scripts": {
    "redproof": "redproof check",
    "redproof:prove": "redproof prove",
    "redproof:describe": "redproof describe"
  }
}
```

Then:

```bash
npm run redproof
npm run redproof:prove
npm run redproof:describe -- gates/no-todo.ts
```

## Learn more

- **[Built-in integrations](docs/adapters.md)**
- **[Composing Redproof](docs/composition.md)**
- **[Tutorials](docs/tutorials/README.md)**

## License

Redproof is licensed under the Apache License 2.0.

See [`LICENSE`](LICENSE).
