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

## Guardrails as first-class citizens

We already know that guardrails are important, but they are rarely treated as
a first-class concept.

Today, guardrails are often scattered across different tools. A lint rule may
enforce one constraint, a dependency checker may enforce another, and a CI
script may enforce something else. Each tool works on its own, but the
guardrail itself is not represented directly. It feels more like
infrastructure than a concept the project can describe and reason about.

Redproof changes that by putting the Rule and the Gate first.

A Rule describes the constraint we want to enforce. A Gate groups related
Rules into one logical boundary. The tools used to enforce those Rules become
implementation details.

This means a single Gate can combine different kinds of checks. For example,
one Rule might use a linter, another might check dependency boundaries, and
another might run a custom script. Together, they form one logical Gate that
represents a single project-level guardrail.

Instead of thinking first about which tool to configure, we can start with the
guardrail we want:

```text
What rule should always hold?
Which rules belong together?
What should prevent a change from crossing this boundary?
```

Then we choose the tools needed to enforce it.

Redproof makes guardrails something the repository can name, compose, prove,
and reason about directly.


## Install

Requires Node.js 24 or later. From your project root, beside `package.json`:

```bash
npm install --save-dev redproof
npm pkg set type=module
```

The config and Gate files are ES modules. Recent `npm init` versions write
`"type": "commonjs"`, which makes Node reject `.ts` files that use `import`.

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
`.js`. To keep a CommonJS package, use `.mts` for the config and every Gate
file, and set `gatesRoot: 'gates/**/*.mts'`. A `.mjs` config alone is not
enough: Node still loads `.ts` Gate files as CommonJS.

## A small Gate

This example needs no additional tools. Create `src/example.ts` with clean source
for the Check to inspect and the proof to modify:

```ts
export const value = 1;
```

The policy is:

> TypeScript source files must not contain the word TODO.

This simple text scan checks comments and strings alike. Save the following as
`gates/no-todo.ts`:

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
    description: 'Source files must not contain the word TODO.',
  },
});

const gate = defineGate({
  id: 'no-todo',
  rules,

  check: {
    description: 'scan TypeScript source files for the word TODO',
    counting: counting.supported,

    async run(ctx) {
      const found = await text.find(ctx, {
        files: 'src/**/*.ts',
        find: /\bTODO\b/g,
      });

      return result.fromBreaches(
        found.scan(),
        found.matches.map(match =>
          breach(rules.noTodo, {
            code: 'todo-found',
            message: 'TODO found in source.',
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
    'detects the word TODO',
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
npx redproof describe gates/no-todo.ts
```

```text
Gate: no-todo

Rules:
  R1 Source files must not contain the word TODO.

Check:
  scan TypeScript source files for the word TODO

Proof R1:
  detects the word TODO
  mutation: append text to src/example.ts
  run the same Check
  expect Gate FAIL

Proof GREEN:
  accepts clean source
  run the same Check
  expect Gate PASS
```

## Run it

With the config, source file and Gate saved, check the current project:

```bash
npx redproof check
```

The clean source passes. Output excerpts below omit the start time; timings vary:

```text
 ✓ gates/no-todo.ts (1 rule) 3ms
   ✓ no-todo


 Gates      1 passed (1)
 Rules      1 held (1)
 Duration   137ms
```

To see a failure, add `// TODO: remove temporary workaround` on the next line of
`src/example.ts` and run `npx redproof check` again:

```text
 ❯ gates/no-todo.ts (1 rule | 1 breached | 1 breach) 4ms
   ❯ no-todo
     × 1 breach


 FAIL  gates/no-todo.ts > no-todo

 ❯ src/example.ts:2:4

     1| export const value = 1;
     2| // TODO: remove temporary workaround
      |    ^
     3|

   TODO found in source.


 Gates      1 failed (1)
 Rules      1 breached (1)
 Breaches   1
 Duration   118ms
```

Remove the TODO line so the project is healthy again, then prove that the Gate
itself works:

```bash
npx redproof prove
```

```text
✓ no-todo / detects the word TODO expected=red actual=fail
    breached source/no-todo: TODO found in source.
✓ no-todo / accepts clean source expected=green actual=pass
```

`expected=red actual=fail` means the RED proof succeeded: its mutation made the
intended Rule fail. The second line names that Rule and the Check's message.

The RED proof temporarily adds a TODO, runs the real Check, confirms `source/no-todo`
was breached, then restores the workspace. By default, proofs run in temporary
Gate copies; see [execution isolation](https://github.com/schalermthai/redproof/blob/main/docs/tutorials/execution-isolation.md).
A proof that did not prove says why: the wrong Rule breached, the Check passed,
or the target was already breached before the mutation.

The GREEN proof confirms that clean source passes.

## Selecting Gates

Every command takes optional Gate files. With none, every discovered Gate runs.

```bash
npx redproof check    gates/no-todo.ts
npx redproof prove    gates/no-todo.ts gates/architecture.ts
npx redproof describe gates/*.ts
```

`check`, `prove`, and `describe` share one selection rule. A path that is not a discovered Gate is an error, never an empty run.

```bash
npx redproof check gates/missing.ts
```

```text
No Gate matched: gates/missing.ts
```

Command-line paths select **which Gates to run**, not **which source files to inspect**. Each Gate defines its own inspection scope:

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

A PASS that inspected zero targets becomes REFUSE by default, because it cannot
establish the Gate's Rules. A Gate whose empty evidence is intentionally valid can
set `policies: { emptyEvidence: 'allow' }`; unknown counts (`inspected: null`)
are not treated as zero.

## Built-in Adapters

You do not need to build every Gate yourself.

Install only the integrations you need, alongside their underlying tools. For
example:

```bash
npm install --save-dev @redproof/eslint eslint
```

- **[`@redproof/testing`](https://github.com/schalermthai/redproof/blob/main/docs/built-in-adapters.md#testing)** — test suites, flaky tests, skipped tests, TODO tests; supports Jest-compatible JSON and JUnit XML
- **[`@redproof/eslint`](https://github.com/schalermthai/redproof/blob/main/docs/built-in-adapters.md#eslint)** — selected ESLint rules as Redproof Rules
- **[`@redproof/dependency-cruiser`](https://github.com/schalermthai/redproof/blob/main/docs/built-in-adapters.md#dependency-cruiser)** — architecture and dependency boundaries
- **[`@redproof/stryker`](https://github.com/schalermthai/redproof/blob/main/docs/built-in-adapters.md#stryker)** — mutation detection and mutation-score policies

See **[Built-in Adapters](https://github.com/schalermthai/redproof/blob/main/docs/built-in-adapters.md)** for examples.

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

Completed failure exits breach the selected Rule. Missing executables, timeouts, signals, output overflow, and explicitly unclassified exits produce **REFUSE**. Each command runs in its own process group. Timeouts, output overflow, and an interrupted Redproof process stop that group. Use `commands()` from the same subpath for deterministic sequential or bounded-parallel command groups.

See **[Command Checks](https://github.com/schalermthai/redproof/blob/main/docs/commands.md)** for exit-code policy,
command groups, and what a Check reports about itself.

See **[Composing Redproof](https://github.com/schalermthai/redproof/blob/main/docs/composition.md)** to create your own Gates, Rules, Checks, Proofs, and Mutations.

See **[Custom Adapter](https://github.com/schalermthai/redproof/blob/main/docs/custom-adapter.md)** when a tool brings its own policy model, and for the guidelines that keep an Adapter's verdicts honest.
Adapter authors can run those guidelines as executable contracts with
**[`@redproof/adapter-tck`](https://github.com/schalermthai/redproof/tree/main/packages/adapter-tck)**.

For execution isolation, machine-readable reports, VS Code, and other workflows, see **[Tutorials](https://github.com/schalermthai/redproof/blob/main/docs/tutorials/README.md)**.

## Project layout and npm scripts

A typical project:

```text
my-project/
├── redproof.config.ts
├── gates/
│   ├── tests.ts
│   ├── no-todo.ts
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

## Install the agent plugin

Use Redproof with Codex or Claude Code to discover, design, build and prove
guardrails. The plugin installs agent skills and, in Claude Code, a Stop hook
that runs your project's `redproof check` when the agent ends a turn. It does
not install the npm library or adapters.

**Codex** — run in your terminal:

```bash
codex plugin marketplace add schalermthai/redproof --ref plugin-marketplace
codex plugin add redproof@redproof-plugins
```

**Claude Code** — run in your terminal:

```bash
claude plugin marketplace add 'schalermthai/redproof#plugin-marketplace'
claude plugin install redproof@redproof-plugins --scope user
```

Start a new session in your project. Select Redproof's **discover** skill in
Codex, or run `/redproof:discover` in Claude Code.

See the **[plugin guide](https://github.com/schalermthai/redproof/tree/main/agents/plugin/redproof)**
for the skills and workflow, or **[Guardrails for agent-written code](https://github.com/schalermthai/redproof/blob/main/docs/agent-guardrails.md)**
for examples.

## Learn more

- **[Built-in Adapters](https://github.com/schalermthai/redproof/blob/main/docs/built-in-adapters.md)**
- **[Command Checks](https://github.com/schalermthai/redproof/blob/main/docs/commands.md)**
- **[Composing Redproof](https://github.com/schalermthai/redproof/blob/main/docs/composition.md)**
- **[Custom Adapter](https://github.com/schalermthai/redproof/blob/main/docs/custom-adapter.md)**
- **[Tutorials](https://github.com/schalermthai/redproof/blob/main/docs/tutorials/README.md)**
- **[Legacy modernization](https://github.com/schalermthai/redproof/blob/main/docs/legacy-modernization.md)**
- **[Red proving Redproof](https://github.com/schalermthai/redproof/blob/main/docs/red-proving-redproof.md)**
- **[Guardrails for agent-written code](https://github.com/schalermthai/redproof/blob/main/docs/agent-guardrails.md)**

## License

Redproof is licensed under the Apache License 2.0.

See [`LICENSE`](LICENSE).
