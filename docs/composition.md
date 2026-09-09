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

```ts fragment
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

```ts fragment
counting.supported
```

or:

```ts fragment
counting.unsupported('The external command only exposes a process status.')
```

Countability is a standing capability of the Check, not something inferred from one run.

## PASS, FAIL, and REFUSE

Use the result constructors rather than manually rebuilding the union:

```ts fragment
result.pass(scan)
result.fail(scan, breaches)
result.refuse(scan, diagnostic)
```

For the common case where you collect zero or more breaches:

```ts fragment
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

```ts fragment
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

```ts fragment
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

```ts fragment
const paths = await files.find(ctx, 'src/**/*.ts');
```

Include and exclude patterns:

```ts fragment
const paths = await files.find(ctx, {
  include: ['src/**/*.ts'],
  exclude: ['src/**/*.test.ts'],
});
```

Other basic helpers:

```ts fragment
files.read(ctx, 'src/example.ts')
files.write(ctx, 'src/example.ts', content)
files.exists(ctx, 'src/example.ts')
files.remove(ctx, 'generated')
files.rename(ctx, 'from.ts', 'to.ts')
```

## Finding text

Search selected files:

```ts fragment
const found = await text.find(ctx, {
  files: 'src/**/*.ts',
  find: /\bTODO\b/g,
});
```

Each match includes:

```ts fragment
match.file
match.text
match.range
match.location
```

For one match:

```ts fragment
const first = await text.findFirst(ctx, {
  files: 'src/**/*.ts',
  find: 'export class Order',
});
```

## Describing a search

`text.find` and `json.query` both return a `scan()` function. It describes that one search:

```ts fragment
const found = await text.find(ctx, { files: 'src/**/*.ts', find: /\bTODO\b/g });

return result.fromBreaches(found.scan(), breaches);
```

`scan()` records the window of the search itself. `inspected` counts the files that search read. `source` is `'text'` or `'json'`.

Override either default when it helps:

```ts fragment
found.scan({ source: 'todo-scan' })
```

Pass `startedAt` when the Check began working before the search:

```ts fragment
async run(ctx) {
  const startedAt = new Date().toISOString();
  const policy = JSON.parse(await files.read(ctx, 'policy.json'));
  const found = await text.find(ctx, { files: 'src/**/*.ts', find: policy.marker });

  return result.fromBreaches(found.scan({ startedAt }), breaches);
}
```

**One `scan()` describes one search.** A Check that runs several searches must build its own `Scan`, or `inspected` will under-count:

```ts fragment
const scan = {
  source: 'markers',
  startedAt,
  finishedAt: new Date().toISOString(),
  inspected: new Set([...todos.files, ...fixmes.files]).size,
};
```

That matters because a Check declaring `counting.supported` promises a reliable count.

## Empty evidence

A Gate refuses an otherwise successful Check when `scan.inspected` is `0`.
Without a target, PASS would claim that every Rule holds without inspecting the
scope the Gate promises to protect. The Check's report remains valid; Redproof
changes only the Gate verdict to REFUSE with the `nothing-inspected` diagnostic.

When an empty target set is intentionally valid, opt in on that Gate:

```ts
import { counting, defineAdapter, defineGate, pass } from 'redproof';

const adapter = defineAdapter({
  kind: 'optional-files',
  rules: {
    valid: { id: 'optional-files/valid', description: 'Optional files are valid.' },
  },
  check: {
    description: 'inspect optional generated files',
    counting: counting.supported,
    async run() {
      return pass({ source: 'optional-files', startedAt: '', finishedAt: '', inspected: 0 });
    },
  },
});

defineGate({
  id: 'optional-generated-files',
  adapter,
  policies: {
    emptyEvidence: 'allow',
  },
})
```

Options that change how Redproof reads a Check result belong under
`policies`. Adapter options say how the Check collects its evidence.

Use the exception narrowly. `inspected: null` means the Check cannot count its
targets and is not treated as zero; FAIL and REFUSE results keep their original
evidence even when their scan count is zero.

## Proofs

A RED proof targets one specific Rule:

```ts fragment
proof.red(
  rules.noTodo,
  'detects a TODO comment',
  mutate.appendText('src/example.ts', '\n// TODO: proof\n'),
)
```

A RED proof only succeeds when that target Rule appears in the Check breaches. An unrelated Gate failure is not enough.

GREEN proves that the healthy state passes:

```ts fragment
proof.green('accepts clean source')
```

REFUSE proves that the Check declines to guess when required evidence is unavailable:

```ts fragment
proof.refuse(
  'refuses when configuration is unavailable',
  mutate.rename('tool.config.ts', 'tool.config.off.ts'),
)
```

Bind proofs to a Gate:

```ts fragment
export const proofs = defineProofs(gate, [
  proof.red(...),
  proof.green(...),
]);
```

## Locators

A locator describes where a mutation should operate when the proof runs.

Text locator:

```ts fragment
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

```ts fragment
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

```ts fragment
mutate.createFile(path, content)
mutate.writeText(path, content)
mutate.deleteFile(path)
mutate.remove(path)
mutate.rename(from, to)
mutate.move(from, to)
```

Text:

```ts fragment
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

```ts fragment
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

```ts fragment
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

```ts fragment
const check = defineCheck(rules, {
  description: 'scan source markers',
  counting: counting.supported,

  async run(ctx) {
    // ...
  },
});
```

This keeps the set of Rules the Check may breach type-safe.

### Command Checks

When the guardrail is already an executable, `command()` and `commands()` from
`redproof/command` build the Check for you. They handle exit-code policy,
timeouts, output limits, and REFUSE.

See **[Command Checks](commands.md)** for the full API, command groups,
sequential and parallel execution, and what a Check reports about itself.

## Creating an Adapter

Use an Adapter when an external system introduces its own policy model. An
Adapter binds a Rule catalogue to one Check with `defineAdapter`, and translates
the external system into Redproof semantics:

```text
real policy violation     → Breach → FAIL
cannot evaluate reliably  → Diagnostic → REFUSE
bad option                → throw before any Check exists
```

Do not infer Redproof semantics from a process exit code when structured evidence can distinguish the two.

See **[Custom Adapter](custom-adapter.md)** for a complete example and
the guidelines that keep its verdicts honest.

## Next

- **[Custom Adapter](custom-adapter.md)**
- **[Built-in Adapters](built-in-adapters.md)**
- **[Execution isolation](tutorials/execution-isolation.md)**
- **[Reporters](tutorials/reporters.md)**
- **[Legacy modernization](legacy-modernization.md)**
