# @redproof/testing

Redproof adapter for test suites. It reads structured JSON or JUnit XML reports,
so any runner that writes one becomes a Redproof Gate you can prove.

Part of [Redproof](https://github.com/schalermthai/redproof). Redproof does not
just run your guardrails. It proves they can fail.

## Install

Requires Node.js 24 or later. Install the adapter and the test runner you use.
For the Vitest example below:

```bash
npm install --save-dev redproof @redproof/testing vitest
```

For another runner, install `redproof @redproof/testing` and provide that runner
separately; Vitest is not required. `vitest()` is tested against Vitest 5.

## Features

- Gives test failures, retries, skips, and TODOs separate Rules instead of one
  command-exit verdict.
- Reads Jest-compatible JSON or JUnit XML, with a ready-made `vitest()` wrapper.
- Refuses missing, malformed, or contradictory reports rather than treating
  incomplete evidence as a pass.
- Supports process timeouts and output limits, and fresh report collection.

## Use

Start with a working Vitest suite and a
[Redproof configuration](https://github.com/schalermthai/redproof#install).
Save this as `gates/unit-tests.ts`:

```ts
// gates/unit-tests.ts
import { vitest } from '@redproof/testing';
import { defineGate } from 'redproof';

const adapter = vitest({
  timeoutMs: 120_000,
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
npx redproof check gates/unit-tests.ts
```

This example checks the selected policies; it does not include proofs. To prove
them, export a `defineProofs` suite with mutations such as breaking tested behavior
or skipping a test, then run `npx redproof prove gates/unit-tests.ts`.
See the [Vitest proof example](https://github.com/schalermthai/redproof/blob/main/fixtures/testing-vitest/gates/tests.ts).

## Supported Rules

The adapter can expose these Rules. The available set depends on the report
format.

| Selection | Rule ID | What must hold | Report support |
|---|---|---|---|
| `testsPass: true` | `testing/tests-pass` | No tests fail. | Jest-compatible JSON, JUnit XML |
| `noFlakyTests: true` | `testing/no-flaky-tests` | No test passes only after a retry. | Jest-compatible JSON with retry evidence |
| `noSkippedTests: true` | `testing/no-skipped-tests` | No tests are skipped. | Jest-compatible JSON, JUnit XML |
| `noTodoTests: true` | `testing/no-todo-tests` | No tests are marked TODO. | Jest-compatible JSON |
| `noXfailTests: true` | `testing/no-xfail-tests` | No tests are marked as expected failures. | pytest JUnit XML (`report.pytestJunitXml()`) |

JUnit XML cannot establish retries or TODO status; selecting `noFlakyTests` or
`noTodoTests` with that format throws when the Adapter is constructed.

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

## pytest

```ts
import { pytest } from '@redproof/testing';

const adapter = pytest({
  command: '.venv/bin/pytest',
  files: ['tests'],
  rules: { testsPass: true, noSkippedTests: true, noXfailTests: true },
});
```

`pytest()` runs `pytest -q --junitxml=<private report>`, then your `args`, then
`files`, and reads the report with `report.pytestJunitXml()`. `command` defaults
to `pytest`. It takes the same `cwd`, `timeoutMs`, and `maxOutputBytes` as the
other runners. Point `command` at the `pytest` entry point rather than
`python -m pytest`, because the adapter's flags come first.

`files` entries are passed to pytest as written (only `cwd` is confined to the Gate
root), so treat them as trusted configuration, as with `vitest()`.

The adapter asks pytest for the `xunit1` JUnit family so each breach carries the
test's file and line (a decorated test reports its first decorator line). `file`
is relative to pytest's rootdir. Your own `-o junit_family=...` in `args` wins,
and locations then become null. pytest writes a failing call and its teardown
error as two entries with one name; the adapter folds them into one failed test
and keeps both messages. For the same reason a test retried by
`pytest-rerunfailures` counts once.

A Rule about absent tests (`noSkippedTests`, `noXfailTests`) can only pass if every
test ran. If pytest stopped early (`-x` or `--maxfail`, `pytest.exit()`, a collection
error, or exit code 2) and nothing breached, the Check REFUSES with
`test-run-incomplete` instead of passing. pytest prints its stop banner even when
`-x` stops on the very last test, so that case refuses too although every test ran. The stop is read from pytest's banner on stdout, with colour codes removed, so a plugin that ends the session silently at exit 0 is not detected. A breach still FAILs, because a breach decides the result either way.
`testsPass` is unaffected. A test that skipped and then errored in teardown still
counts as skipped.

pytest's JUnit XML cannot show retries or TODO tests, so `noFlakyTests` and
`noTodoTests` are not available here. Use the generic `testing()` adapter with
another report format if you need them.

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

  report: report.pytestJunitXml(),

  rules: {
    testsPass: true,
    noSkippedTests: true,
    noXfailTests: true,
  },
});
```

Built-in report formats are `report.jestJson()`, `report.junitXml()` and
`report.pytestJunitXml()`.

pytest writes an expected failure (xfail) as `<skipped type="pytest.xfail">`,
the same element it uses for a real skip. Generic `report.junitXml()` cannot
tell them apart, so it counts both as skipped. Use `report.pytestJunitXml()` to
read xfail as its own status: `noSkippedTests` then counts only real skips, and
`noXfailTests` breaches on the expected failures. Selecting `noXfailTests` with
any other format throws when the Adapter is constructed. pytest's JUnit XML
still cannot show retries, TODOs, or an unexpected pass (xpass is a plain
pass), so `noFlakyTests` and `noTodoTests` stay unavailable with it.

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

See [all built-in Adapters and the comparison with Command Checks](https://github.com/schalermthai/redproof/blob/main/docs/built-in-adapters.md).

## License

Apache-2.0
