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

// defining Rules
const rules = defineRules({
  noTodo: {
    id: 'source/no-todo',
    description: 'Source files must not contain TODO comments.',
  },
});

// defining a Gate
const gate = defineGate({
  id: 'no-todo',
  rules,  // assigning rules to a gate

  check: {
    description: 'scan TypeScript source files for TODO comments',
    counting: counting.supported,

    async run(ctx) {

      // scan all Typescript to find //TODO comment
      const found = await text.find(ctx, {
        files: 'src/**/*.ts',
        find: /\bTODO\b/g,
      });

      // should detect a breach
      return result.fromBreaches(
        found.scan(),
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

// defining Proofs
export const proofs = defineProofs(gate, [
  proof.red(
    rules.noTodo,
    'detects a TODO comment',

    // deliberately inject //TODO into src/example.ts
    // healthy Gate should catch it!
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

## Selecting Gates

Every command takes optional Gate files. With none, every discovered Gate runs.

```bash
redproof check    gates/no-todo.ts
redproof prove    gates/no-todo.ts gates/architecture.ts
redproof describe gates/*.ts
```

`check`, `prove`, and `describe` share one selection rule. A path that is not a discovered Gate is an error, never an empty run.

```bash
redproof check gates/missing.ts
```

```text
No Gate matched: gates/missing.ts
```

Gate files choose **which Gates run**. They never change **what a Gate inspects**. A Gate owns its own scope:

```ts fragment
text.find(ctx, { files: 'src/**/*.ts' })
```

If the command line could narrow that scope, a PASS would no longer mean the Gate passed. That matters most for `prove`, because each proof was written against the real scope of its Gate.

Redproof also supports **REFUSE** when a Check cannot make a trustworthy PASS or FAIL decision.

```text
PASS     the Gate holds
FAIL     one or more Rules were breached
REFUSE   the Check could not decide safely
```

## Built-in integrations

You do not need to build every Gate yourself.

- **[`@redproof/testing`](https://github.com/schalermthai/redproof/blob/main/docs/adapters.md#testing)** — test suites, skipped tests, TODO tests; supports Jest-compatible JSON and JUnit XML
- **[`@redproof/eslint`](https://github.com/schalermthai/redproof/blob/main/docs/adapters.md#eslint)** — selected ESLint rules as Redproof Rules
- **[`@redproof/dependency-cruiser`](https://github.com/schalermthai/redproof/blob/main/docs/adapters.md#dependency-cruiser)** — architecture and dependency boundaries
- **[`@redproof/stryker`](https://github.com/schalermthai/redproof/blob/main/docs/adapters.md#stryker)** — mutation detection and mutation-score policies

See **[Built-in integrations](https://github.com/schalermthai/redproof/blob/main/docs/adapters.md)** for examples.

## Build your own

Redproof is designed to be composed when an existing integration does not fit your guardrail.

For a guardrail exposed as an executable, use the official `redproof/command` Check:

```ts fragment
import { command } from 'redproof/command';

const gate = defineGate({
  id: 'docs',
  rules,
  check: command({
    rule: rules.docs,
    command: 'npm',
    args: ['run', 'lint:docs'],
  }),
});
```

Completed failure exits breach the selected Rule. Missing executables, timeouts, signals, output overflow, and explicitly unclassified exits produce **REFUSE**. Use `commands()` from the same subpath for deterministic sequential or bounded-parallel command groups.

See **[Command Checks](https://github.com/schalermthai/redproof/blob/main/docs/commands.md)** for exit-code policy,
command groups, and what a Check reports about itself.

See **[Composing Redproof](https://github.com/schalermthai/redproof/blob/main/docs/composition.md)** to create your own Gates, Rules, Checks, Proofs, Mutations, and Adapters.

For execution isolation, machine-readable reports, VS Code, and other workflows, see **[Tutorials](https://github.com/schalermthai/redproof/blob/main/docs/tutorials/README.md)**.

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

The CLI also discovers `redproof.config.mts`, `.mjs`, `.cts`, `.cjs`, and
`.js`. CommonJS projects can use `redproof.config.mjs` to keep the config and
Gate modules in ESM without adding `"type": "module"` to the whole package.

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

- **[Built-in integrations](https://github.com/schalermthai/redproof/blob/main/docs/adapters.md)**
- **[Command Checks](https://github.com/schalermthai/redproof/blob/main/docs/commands.md)**
- **[Composing Redproof](https://github.com/schalermthai/redproof/blob/main/docs/composition.md)**
- **[Tutorials](https://github.com/schalermthai/redproof/blob/main/docs/tutorials/README.md)**
- **[Legacy modernization](https://github.com/schalermthai/redproof/blob/main/docs/legacy-modernization.md)**
- **[Self-hosting Redproof](https://github.com/schalermthai/redproof/blob/main/docs/self-hosting.md)**

## License

Redproof is licensed under the Apache License 2.0.

See [`LICENSE`](LICENSE).
