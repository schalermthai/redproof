# @redproof/testing

Redproof adapter for test suites. It reads structured JSON or JUnit XML reports,
so any runner that writes one becomes a Redproof Gate you can prove.

Part of [Redproof](https://github.com/schalermthai/redproof). Redproof does not
just run your guardrails. It proves they can fail.

## Install

```bash
npm install --save-dev @redproof/testing redproof
```

## Use

```ts
// gates/unit-tests.ts
import { vitest } from '@redproof/testing';
import { defineGate } from 'redproof';

const adapter = vitest({
  cwd: 'packages/app',
  configFile: 'vitest.config.js',
  reportFile: 'test-results.json',
  timeoutMs: 120_000,
  maxOutputBytes: 20 * 1024 * 1024,
  rules: {
    testsPass: true,
    noFlakyTests: true,
    noSkippedTests: true,
    noTodoTests: true,
  },
});

export default defineGate({ id: 'unit-tests', adapter });
```

Then run:

```bash
npx redproof check   # do the rules hold right now?
npx redproof prove   # can each rule actually fail?
```

## Rules

The adapter can expose these Rules. The available set depends on the report
format.

- `testing/tests-pass`
- `testing/no-flaky-tests` (Jest-compatible JSON only)
- `testing/no-skipped-tests`
- `testing/no-todo-tests`

`noFlakyTests` breaches when a test passes only after a retry. The evidence
differs by producer. Vitest keeps the failure messages of earlier attempts in
its Jest-compatible JSON report. Jest clears them, reports `invocations` greater
than 1, and fills `retryReasons` only when `logErrorsBeforeRetry` is set.
Redproof reads all three signals. JUnit XML records only the final outcome, so
Redproof refuses `noFlakyTests` with that format when the adapter is composed.

When a Jest-compatible JSON report includes total or failed test counts, Redproof
checks them against the contained assertions. A contradictory report refuses
the Gate instead of producing a false PASS from incomplete result data.

## Paths

Every Vitest path option must be a non-empty relative path. That covers `cwd`,
`configFile`, `reportFile`, and each entry of `files`. An empty or absolute
value throws when the Gate file loads. The raw `args` list is not checked, so
it can still carry an absolute path.

`cwd` selects a project below the Gate root. It is relative to the Gate root
and confined inside it. `configFile` and the `files` filters follow Vitest's
normal cwd-relative resolution.

`reportFile` consumes a JSON `outputFile` already configured by Vitest, so
project setup or teardown code can inspect the same fresh report. It is
relative to `cwd` and must name the same file as the config `outputFile`. A
keyed `outputFile` works when `reportFile` matches its `json` entry. Keep the
Vitest `root` at `cwd`. If the two disagree, the Check refuses because the
report is not found.

Redproof restores any pre-existing report afterward. The report's parent
directory may be absent when Vitest creates it during the run; Redproof removes
newly created report directories that remain empty. Omit `reportFile` to use
Redproof's private temporary report.

## Process limits

`timeoutMs` bounds the complete Vitest invocation. `maxOutputBytes` bounds
combined stdout and stderr capture and defaults to 10 MiB. Exceeding either
limit REFUSES the Gate and stops the Vitest process group before returning.
Workers and test-created child processes in that group stop with it. A process
that starts its own session is outside the group. The run is stopped, not
truncated, so a Gate above the limit refuses instead of reading a partial report.

## Vitest flags

Redproof passes `--no-cache` to Vitest. Without it, Vitest writes a results
cache under `node_modules/.vite` inside the project, and a proof run refuses
with `workspace-not-restored`. The adapter is proven against Vitest 5.

Vite's default config loader has the same effect. It writes a temporary bundle
of the config file under the nearest `node_modules/.vite-temp` and leaves that
directory behind. When a `node_modules` directory sits inside the Gate root, as
in a pnpm workspace, a proof run refuses with `workspace-not-restored`. Pass
`args: ['--configLoader', 'runner']` to load the config without that bundle.
The flag needs Vitest 3.1 or later, and Vitest marks the loader experimental.

## Other test runners

You do not need a dedicated Redproof package for every test framework. Use the
generic `testing()` adapter with a runner and a structured report format:

```ts
import { report, runner, testing } from '@redproof/testing';

const adapter = testing({
  runner: runner.command({
    command: 'pytest',
    timeoutMs: 120_000,
    maxOutputBytes: 10 * 1024 * 1024,
    args: ({ reportFile }) => [
      '-q',
      `--junitxml=${reportFile}`,
    ],
  }),

  report: report.junitXml(),

  rules: {
    testsPass: true,
    noSkippedTests: true,
  },
});
```

Built-in report formats:

```ts
report.jestJson()
report.junitXml()
```

Set `cwd` to run a generic test command below the Gate root. Redproof rejects
both `..` escapes and symbolic links that resolve outside the root. The
`command` option is not a path option, so an absolute command is allowed.

The generic runner accepts the same `timeoutMs` and `maxOutputBytes` process
limits as `vitest()` and uses the shared `redproof/command` process supervisor.
Spawn failures, signals, and exceeded limits are reported as unavailable test
evidence, so the Gate REFUSES rather than guessing.

For a custom test system, implement only the runner or the report format. See
[Extend the testing adapter instead](https://github.com/schalermthai/redproof/blob/main/docs/custom-adapter.md#extend-the-testing-adapter-instead).

## What a command runner reports about itself

A command runner states what it will run. `redproof describe` uses this, so a
Gate does not need a hand-written sentence that can drift from the real command.

```ts
import { runner } from '@redproof/testing';

const built = runner.command({ command: 'npm', args: ['test'] });

built.description;                                  // 'run npm test'
built.plan;                                         // { command: 'npm', args: ['test'] }
built.argsFor?.({ root: '.', reportFile: 'r.xml' }); // ['test']
```

`plan.args` is present only when the arguments are a fixed list. When `args` is
a function, the arguments depend on the run, so `plan` carries the command
alone and `argsFor` answers for one run.

The default description uses the command's base name. A description therefore
reads the same on every machine, even when `command` is an absolute path. Set
`description` yourself when a sentence explains more than the command line does.

A Check built from `redproof/command` reports itself the same way. See
[What a Check says about itself](https://github.com/schalermthai/redproof/blob/main/docs/commands.md#what-a-check-says-about-itself).

## Documentation

See the [Redproof documentation](https://github.com/schalermthai/redproof#readme).

## License

Apache-2.0
