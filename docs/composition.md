# Composing Redproof

Use the composition API when a built-in integration does not match the guardrail you want to enforce.

The important model is:

```text
Gate
└── Adapter
     ├── Rules
     └── Check
          └── PASS | FAIL | REFUSE
```

A native Gate uses the same model; `defineGate({ rules, check })` supplies the native Adapter for you.

## Rules

A Rule is one claim that must hold.

```ts
import { defineRules } from 'redproof';

const rules = defineRules({
  noTodo: {
    id: 'source/no-todo',
    description: 'Source files must not contain TODO comments.',
  },

  noFixme: {
    id: 'source/no-fixme',
    description: 'Source files must not contain FIXME comments.',
  },
});
```

The aliases (`noTodo`, `noFixme`) are for authoring. The `id` is the stable Rule identity used by breaches and proofs.

## Checks

A Check evaluates the Gate as a whole.

```ts
check: {
  description: 'scan source files for unfinished-work markers',
  counting: counting.supported,

  async run(ctx) {
    // inspect the project
    // return PASS, FAIL, or REFUSE
  },
}
```

Every Check declares whether it supports reliable breach counting:

```ts
counting.supported
```

or:

```ts
counting.unsupported('The external command only exposes a process status.')
```

Countability is a standing capability of the Check, not something inferred from one run.

## PASS, FAIL, and REFUSE

Use the result constructors rather than manually rebuilding the union:

```ts
result.pass(scan)
result.fail(scan, breaches)
result.refuse(scan, diagnostic)
```

For the common case where you collect zero or more breaches:

```ts
return result.fromBreaches(scan, breaches);
```

This means:

```text
0 breaches   → PASS
1..N         → FAIL
```

`REFUSE` remains explicit because it has different meaning: the Check could not make a trustworthy decision.

## Breaches and diagnostics

A Breach is one concrete violation of one Rule:

```ts
breach(rules.noTodo, {
  code: 'todo-found',
  message: 'TODO comment found.',
  location: {
    file: 'src/example.ts',
    line: 8,
    column: 1,
  },
});
```

A diagnostic can also be locationless:

```ts
{
  code: 'budget-exceeded',
  message: 'CPU budget exceeded.',
  location: null,
  comparison: {
    expected: '<= 238s',
    actual: '251.4s',
  },
}
```

A refusal carries a Diagnostic, not a Breach, because Redproof has not established that any Rule was violated.

## Finding files

Redproof filesystem helpers are scoped to the Check or Mutation root:

```ts
const paths = await files.find(ctx, 'src/**/*.ts');
```

Include and exclude patterns:

```ts
const paths = await files.find(ctx, {
  include: ['src/**/*.ts'],
  exclude: ['src/**/*.test.ts'],
});
```

Other basic helpers:

```ts
files.read(ctx, 'src/example.ts')
files.write(ctx, 'src/example.ts', content)
files.exists(ctx, 'src/example.ts')
files.remove(ctx, 'generated')
files.rename(ctx, 'from.ts', 'to.ts')
```

## Finding text

Search selected files:

```ts
const found = await text.find(ctx, {
  files: 'src/**/*.ts',
  find: /\bTODO\b/g,
});
```

Each match includes:

```ts
match.file
match.text
match.range
match.location
```

For one match:

```ts
const first = await text.findFirst(ctx, {
  files: 'src/**/*.ts',
  find: 'export class Order',
});
```

## Proofs

A RED proof targets one specific Rule:

```ts
proof.red(
  rules.noTodo,
  'detects a TODO comment',
  mutate.appendText('src/example.ts', '\n// TODO: proof\n'),
)
```

A RED proof only succeeds when that target Rule appears in the Check breaches. An unrelated Gate failure is not enough.

GREEN proves that the healthy state passes:

```ts
proof.green('accepts clean source')
```

REFUSE proves that the Check declines to guess when required evidence is unavailable:

```ts
proof.refuse(
  'refuses when configuration is unavailable',
  mutate.rename('tool.config.ts', 'tool.config.off.ts'),
)
```

Bind proofs to a Gate:

```ts
export const proofs = defineProofs(gate, [
  proof.red(...),
  proof.green(...),
]);
```

## Locators

A locator describes where a mutation should operate when the proof runs.

Text locator:

```ts
locate.text({
  files: 'src/example.ts',
  find: 'export const answer = 42;',
})
```

Locators default to `occurrence: 'only'`. If multiple matches exist, Redproof fails instead of silently changing an arbitrary location.

Choose explicitly when multiple matches are expected:

```ts
occurrence: 'first'
occurrence: 'last'
occurrence: 0
```

JSON locator:

```ts
locate.json({
  files: 'package.json',
  path: '$.scripts.test',
})
```

The current JSONPath subset supports:

```text
$
$.scripts.test
$["lint:fix"]
$.items[0]
$.items[*].name
$.scripts.*
```

## Built-in mutations

Filesystem:

```ts
mutate.createFile(path, content)
mutate.writeText(path, content)
mutate.deleteFile(path)
mutate.remove(path)
mutate.rename(from, to)
mutate.move(from, to)
```

Text:

```ts
mutate.appendText(path, text)
mutate.replaceText(locator, replacement)
mutate.replaceAllText(query, replacement)
mutate.insertBefore(locator, text)
mutate.insertAfter(locator, text)
mutate.removeText(locator)
mutate.insertLine(path, line, text)
mutate.removeLine(path, line)
```

JSON:

```ts
mutate.jsonSet(locator, value)
mutate.jsonDelete(locator)
mutate.jsonMerge(locator, patch)
mutate.jsonPush(locator, value)
```

Built-in mutations provide their own undo behavior.

## Custom mutations

For custom filesystem changes, `defineMutation` can capture paths and create the undo operation for you:

```ts
import { defineMutation } from 'redproof';

const breakState = defineMutation({
  description: 'replace SAFE with BROKEN',
  capture: 'src/state.txt',

  async apply(ctx) {
    const before = await ctx.files.read('src/state.txt');
    await ctx.files.write(
      'src/state.txt',
      before.replace('SAFE', 'BROKEN'),
    );
  },
});
```

For complete control, return the undo yourself:

```ts
const mutation = defineMutation({
  description: 'custom mutation',

  async apply(ctx) {
    const before = await ctx.files.read('src/state.txt');
    await ctx.files.write('src/state.txt', 'BROKEN');

    return async () => {
      await ctx.files.write('src/state.txt', before);
    };
  },
});
```

## Reusable Checks

When a Check is useful outside one Gate definition, bind it to a Rule catalog explicitly:

```ts
const check = defineCheck(rules, {
  description: 'scan source markers',
  counting: counting.supported,

  async run(ctx) {
    // ...
  },
});
```

This keeps the set of Rules the Check may breach type-safe.

## Creating an Adapter

Use an Adapter when an external system introduces its own policy model.

```ts
import {
  breach,
  counting,
  defineAdapter,
  defineRules,
  result,
} from 'redproof';

export function myTool() {
  const rules = defineRules({
    policy: {
      id: 'my-tool/policy',
      description: 'The external policy must hold.',
    },
  });

  return defineAdapter({
    kind: 'my-tool',
    rules,

    check: {
      description: 'run my tool and interpret its structured findings',
      counting: counting.supported,

      async run(ctx) {
        const startedAt = new Date().toISOString();

        try {
          const findings = await runMyTool(ctx.root);
          const scan = {
            source: 'my-tool',
            startedAt,
            finishedAt: new Date().toISOString(),
            inspected: findings.length,
          } as const;

          return result.fromBreaches(
            scan,
            findings.map(finding =>
              breach(rules.policy, {
                code: finding.code,
                message: finding.message,
                location: finding.location,
              }),
            ),
          );
        } catch (error) {
          return result.refuse(
            {
              source: 'my-tool',
              startedAt,
              finishedAt: new Date().toISOString(),
              inspected: null,
            },
            {
              code: 'my-tool-unavailable',
              message: 'The external tool could not complete the check.',
              location: null,
              detail: error instanceof Error ? error.message : String(error),
            },
          );
        }
      },
    },
  });
}
```

The Adapter should translate the external system into Redproof semantics:

```text
real policy violation     → Breach → FAIL
cannot evaluate reliably  → Diagnostic → REFUSE
```

Do not infer Redproof semantics from a process exit code when structured evidence can distinguish the two.

## Next

- **[Built-in integrations](adapters.md)**
- **[Execution isolation](tutorials/execution-isolation.md)**
- **[Reporters](tutorials/reporters.md)**
