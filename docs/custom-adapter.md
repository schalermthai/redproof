# Custom Adapter

An Adapter translates an external tool into Redproof Rules and one Check. It
is for a serious integration: a tool that brings its own policy model, such as
a rule catalogue or a score. Most Gates do not need one.

This page first shows the two simpler options. Then it shows how to build an
Adapter, and the rules that keep its verdicts honest. The `@redproof/testing`
package follows every rule here, so its source is the worked example.

- [Decide what to build](#decide-what-to-build)
- [Three lanes for a wrong answer](#three-lanes-for-a-wrong-answer)
- [The shape of an Adapter](#the-shape-of-an-adapter)
- [Guidelines](#guidelines)
- [Extend the testing adapter instead](#extend-the-testing-adapter-instead)
- [Prove it](#prove-it)

## Decide what to build

Try the two simpler options first. Build an Adapter only when neither fits.

### A native Check with `run()`

When you can find the evidence yourself, write the Check inline. The no-todo
Gate in the README is complete with no Adapter. It scans source files and
reports each match as a Breach of one Rule.

```ts
import { breach, counting, defineGate, defineRules, result, text } from 'redproof';

const rules = defineRules({
  noTodo: {
    id: 'source/no-todo',
    description: 'Source files must not contain TODO comments.',
  },
});

export default defineGate({
  id: 'no-todo',
  rules,

  check: {
    description: 'scan TypeScript source files for TODO comments',
    counting: counting.supported,

    async run(ctx) {
      const found = await text.find(ctx, { files: 'src/**/*.ts', find: /\bTODO\b/g });
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
```

### A Command Check that delegates to the tool

When the guardrail already exists as an executable, `redproof/command` builds
the Check for you. The exit code decides the verdict. A missing executable, a
timeout, or an exit code outside the policy becomes REFUSE.

```ts
import { defineGate, defineRules } from 'redproof';
import { command } from 'redproof/command';

const rules = defineRules({
  docs: {
    id: 'docs/lint',
    description: 'Documentation must pass lint.',
  },
});

export default defineGate({
  id: 'docs',
  rules,
  check: command({
    rule: rules.docs,
    command: 'npm',
    args: ['run', 'lint:docs'],
  }),
});
```

See **[Command Checks](commands.md)** for exit-code policy, command groups, and
what a Check reports about itself.

### An Adapter

> Create an Adapter when the tool brings its own policy model, such as a rule
> catalogue or a score, and one Gate must expose several of its policies as
> Redproof Rules.

> Create a runner or a report format, not an Adapter, when the tool only changes
> how a test suite starts, or how its results are written. See
> [Extend the testing adapter instead](#extend-the-testing-adapter-instead).

The rest of this page is for the Adapter case.

## Three lanes for a wrong answer

A Check returns PASS, FAIL, or REFUSE. An Adapter adds one lane before them: a
bad option throws when the Gate module loads. No Check exists yet, so no verdict
exists yet.

| Lane | When | Mechanism |
|---|---|---|
| Load-time error | The option alone proves the Gate is wrong | `throw` in the Adapter factory |
| REFUSE | The run happened, but the evidence cannot be trusted | `result.refuse` with a Diagnostic |
| FAIL | The report proves a Rule broken | `result.fromBreaches` with Breaches |

Sort every failure into one lane. The guidelines below say how.

## The shape of an Adapter

This example compiles. It runs an imaginary tool and interprets its findings.

```ts
import { breach, counting, defineAdapter, defineRules, result } from 'redproof';

type Finding = {
  readonly code: string;
  readonly message: string;
  readonly file: string;
  readonly line: number;
};

type ToolRun =
  | { readonly kind: 'completed'; readonly exitCode: number; readonly findings: readonly Finding[] }
  | { readonly kind: 'unavailable'; readonly message: string; readonly detail?: string };

declare function runMyTool(root: string, configFile: string): Promise<ToolRun>;

export function myTool(options: { readonly configFile: string }) {
  if (!options.configFile.trim()) {
    throw new Error('myTool requires a configFile.');
  }

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
        const scan = (inspected: number | null) => ({
          source: 'my-tool',
          startedAt,
          finishedAt: new Date().toISOString(),
          inspected,
        });

        const run = await runMyTool(ctx.root, options.configFile);

        if (run.kind === 'unavailable') {
          return result.refuse(scan(null), {
            code: 'my-tool-unavailable',
            message: run.message,
            location: null,
            ...(run.detail ? { detail: run.detail } : {}),
          });
        }

        if (run.exitCode !== 0 && run.findings.length === 0) {
          return result.refuse(scan(null), {
            code: 'my-tool-unsuccessful',
            message: 'my tool exited unsuccessfully without structured findings.',
            location: null,
          });
        }

        return result.fromBreaches(
          scan(run.findings.length),
          run.findings.map(finding =>
            breach(rules.policy, {
              code: finding.code,
              message: finding.message,
              location: { file: finding.file, line: finding.line, column: null },
            }),
          ),
        );
      },
    },
  });
}
```

The Adapter translates the tool into Redproof semantics:

```text
real policy violation     → Breach → FAIL
cannot evaluate reliably  → Diagnostic → REFUSE
bad option                → throw before any Check exists
```

The Gate boundary also protects every Adapter from a vacuous success: a PASS
with `scan.inspected === 0` becomes `nothing-inspected` REFUSE by default. Keep
valid empty reports parseable, and use `allowEmptyInspection: true` on the Gate
only when an empty target set is part of that Gate's declared policy.

## Guidelines

### 1. Validate options in the constructor and throw

Bad configuration is not a verdict. A REFUSE would say the run was tried. A
throw says the Gate was never valid. Check every option that the option alone
can prove wrong: an empty Rule set, an unknown key, an empty or absolute path.

The testing adapter does this before it builds a Rule catalogue:

```ts
import type { TestRuleOptions } from '@redproof/testing';

declare const options: { readonly rules: TestRuleOptions };

if (
  !options.rules.testsPass
  && !options.rules.noFlakyTests
  && !options.rules.noSkippedTests
  && !options.rules.noTodoTests
) {
  throw new Error('Testing adapter requires at least one Redproof rule.');
}
```

### 2. Give your runner a result union with an unavailable case

Never throw from `run`. A throw inside a Check is not one of the three
verdicts. Return `completed` when the tool ran, and `unavailable` when it could
not. The Adapter maps `unavailable` to one REFUSE code.

```ts
import { defineTestRunner } from '@redproof/testing';

declare function startInHouseTool(
  reportFile: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }>;

export const inHouseRunner = defineTestRunner({
  description: 'run the in-house test tool',

  async run(ctx) {
    const started = await startInHouseTool(ctx.reportFile).catch((error: Error) => error);
    if (started instanceof Error) {
      return {
        kind: 'unavailable',
        message: 'The in-house test tool could not start.',
        detail: started.message,
      };
    }
    return { kind: 'completed', ...started };
  },
});
```

A wrapper that sets a report aside and restores it afterwards follows the same
rule. A failed restore returns `unavailable` and replaces the run's outcome,
because the project is no longer in its starting state.

### 3. Keep the parser pure and let it throw on untrusted structure

The parser turns text into a model. It has no filesystem and no process. When
the structure cannot be trusted, throw. A missing list, an unknown status, or a
total that contradicts the listed items are all throws.

Map every parser throw to one REFUSE code in the shell. The testing adapter
catches them in one place and returns `test-report-unavailable`:

```text
try {
  run = normalizeRun(root, options.report.parse(await readFile(reportFile, 'utf8')));
} catch (error) {
  return result.refuse(scan, {
    code: 'test-report-unavailable',
    message: 'The test command did not produce a trustworthy structured report.',
    location: null,
    detail: error instanceof Error ? error.message : String(error),
  });
}
```

Compare only the totals that every producer agrees on. Vitest 1.x counts a
skipped test as passed, and every Vitest version leaves tests that never ran
under `bail` out of its pending count. The testing adapter therefore compares
only the total and failed counts.

### 4. Declare capabilities on the report format

A report format states what it can see. A Rule that needs evidence the format
does not carry is rejected when the Gate loads, not at run time.

JUnit XML records only the final outcome, so it cannot show a retry:

```ts
import type { TestReportFormat, TestRuleOptions } from '@redproof/testing';

declare const options: { readonly rules: TestRuleOptions; readonly report: TestReportFormat };

if (options.rules.noFlakyTests && !options.report.capabilities.flaky) {
  throw new Error(`Report format ${options.report.kind} cannot distinguish flaky tests.`);
}
```

### 5. Emit a Breach only from structured evidence

A Breach names one Rule and one location. Build it from the tool's structured
output, never from its exit code alone. Keep the exit code as the last guard:
a failing exit with zero structured failures is a REFUSE, because something
went wrong that the report does not explain.

```text
if (execution.exitCode !== 0 && counts.failed === 0) {
  return result.refuse(scan, {
    code: 'test-runner-unsuccessful',
    message: 'The test command exited unsuccessfully without structured failed tests explaining the exit.',
    location: null,
  });
}
```

## Extend the testing adapter instead

When your tool is a test runner, you do not need a new Adapter. The testing
adapter composes a `TestRunner` and a `TestReportFormat`. Implement only the
part that differs.

```ts
import { defineTestReport, defineTestRunner, testing, type TestCase } from '@redproof/testing';

declare function startInHouseTool(
  reportFile: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }>;
declare function toTestCase(entry: unknown): TestCase;

const inHouseRunner = defineTestRunner({
  description: 'run the in-house test tool',
  async run(ctx) {
    const started = await startInHouseTool(ctx.reportFile).catch((error: Error) => error);
    if (started instanceof Error) {
      return { kind: 'unavailable', message: 'The in-house test tool could not start.', detail: started.message };
    }
    return { kind: 'completed', ...started };
  },
});

const inHouseJson = defineTestReport({
  kind: 'in-house-json',
  extension: '.json',
  capabilities: { todo: false },
  parse(input) {
    const parsed = JSON.parse(input) as { tests?: unknown };
    if (!Array.isArray(parsed.tests)) {
      throw new Error('In-house report is missing tests.');
    }
    return { tests: parsed.tests.map(toTestCase) };
  },
});

export const adapter = testing({
  runner: inHouseRunner,
  report: inHouseJson,
  rules: { testsPass: true, noSkippedTests: true },
});
```

The built-in `runner.command` already confines `cwd` inside the Gate root and
reports what it will run. Prefer it when the tool is a command line.

## Prove it

An Adapter is only as good as its proofs. Write one RED proof per Rule, one
GREEN proof, and one REFUSE proof that removes the evidence the Check needs.
The REFUSE proof is the one people skip. It is the one that shows the Adapter
does not guess.

See **[Proofs](composition.md#proofs)** for the API, and the
[Vitest fixture Gate](../fixtures/testing-vitest/gates/tests.ts) for all three
kinds against one Adapter.

## Next

- **[Composing Redproof](composition.md)** for Rules, Checks, Proofs, and Mutations.
- **[Command Checks](commands.md)** for a guardrail that is already an executable.
- **[Built-in Adapters](built-in-adapters.md)** for the Adapters that ship with Redproof.
