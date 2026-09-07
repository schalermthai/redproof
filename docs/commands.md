# Command Checks

A **Check** decides whether the Rules of a Gate hold. When a guardrail already
exists as an executable, you do not need to write that Check by hand.

`redproof/command` builds a Check from a command line. It is part of the Check
layer, not an Adapter. Reach for an Adapter only when a tool brings its own
policy model, such as a rule catalogue or a score.

- [One command](#one-command)
- [Exit codes decide the verdict](#exit-codes-decide-the-verdict)
- [When a command REFUSES](#when-a-command-refuses)
- [Several commands](#several-commands)
- [Order and precedence](#order-and-precedence)
- [What a Check says about itself](#what-a-check-says-about-itself)

## One command

Use `command()` when one executable answers for one Rule, and its process status
is the trustworthy result.

```ts fragment
import { command } from 'redproof/command';

const check = command({
  rule: rules.docs,
  command: 'npm',
  args: ['run', 'lint:docs'],
  timeoutMs: 60_000,
});
```

Relative `cwd` values resolve inside the Gate workspace and cannot escape it.
Child output is captured for diagnostics. It is never inherited by reporter
output, so a machine-readable report stays clean.

## Exit codes decide the verdict

By default, exit code `0` produces PASS. Any other ordinary exit code breaches
`rule`.

Give an explicit policy when the tool separates findings from configuration or
invocation errors.

```ts fragment
const check = command({
  rule: rules.lint,
  command: 'eslint',
  args: ['src'],
  exitCodes: {
    pass: [0],
    breach: [1],
  },
});
```

Here exit code `2` produces REFUSE. It is neither a passing exit nor a breach
exit, so the Check cannot decide.

## When a command REFUSES

REFUSE means the Check could not make a trustworthy decision. It is never a
pass, and it is never a rule breach. These five cases produce it.

- The executable cannot start.
- The process exceeds `timeoutMs`.
- The process is terminated by a signal.
- Combined stdout and stderr exceed `maxOutputBytes`, which defaults to 10 MiB.
- The process returns an exit code that no explicit policy covers.

## Several commands

Use `commands()` when one Gate depends on more than one executable. Sequential
execution is the safe default.

```ts fragment
import { commands } from 'redproof/command';

const check = commands({
  entries: [
    { rule: rules.metadata, command: 'npm', args: ['run', 'lint:package-json'] },
    { rule: rules.ordering, command: 'npm', args: ['run', 'lint:package-json-sorting'] },
  ],
});
```

Parallel execution is explicit and bounded.

```ts fragment
const check = commands({
  mode: 'parallel',
  maxAtOnce: 2,
  entries: [
    { rule: rules.docs, command: 'npm', args: ['run', 'lint:docs'] },
    { rule: rules.types, command: 'npm', args: ['run', 'lint:types'] },
  ],
});
```

## Order and precedence

Results stay in declaration order, even when commands finish in a different
order. A report therefore reads the same on every run.

Sequential execution stops at the first REFUSE.

Parallel execution waits for the started group. REFUSE then takes precedence
over any collected Breaches, because the Gate could not make a complete
decision.

## What a Check says about itself

A command Check describes itself from its own command line. `redproof describe`
prints that description, so a reader can see what a Gate will run.

```text
Check:
  run npm run lint:docs
```

A group names its commands.

```text
Check:
  run 3 commands: workspace TypeScript, documentation examples, documentation fragment budget
```

A group entry uses its `label` when it has one, and the base name of its command
otherwise. The base name is used on purpose. A description reads the same on
every machine, even when `command` holds an absolute path.

Set `description` yourself when a sentence explains more than the command line
does. An explicit description always wins.

## Next

- **[Composing Redproof](composition.md)** for Rules, Checks, Proofs, and
  Mutations.
- **[Built-in integrations](adapters.md)** for tools that bring their own policy
  model.
