# The Contract-to-Gate method

Use this method when a team has a quality idea that should become a reliable,
reusable guardrail. It works for Adapters, APIs, workflows, configuration,
architecture, documentation, and release policy.

The method turns an intention into four concrete things:

- a promise that can be observed
- a Rule that names the promise
- a Check that gathers the evidence
- Proofs that show the guardrail can catch a deliberate violation

## The method

### 1. State the promise

Write one sentence describing the behavior that must hold. Avoid vague goals
such as “the integration should be robust.” Prefer a statement that can be
checked, such as “an unavailable dependency refuses without changing the
project” or “a release contains every package in the workspace.”

Also state what is outside the promise. A clear boundary prevents one Rule
from quietly becoming a whole quality program.

### 2. Define the Rule and its lanes

Give the promise a Rule with a stable identity and description. Decide how each
bad situation is classified:

- **FAIL** when the evidence proves the Rule is broken
- **REFUSE** when the evidence is missing, contradictory, or unsafe to trust
- **configuration error** when the option is invalid before any run begins

This is where the team decides what the guardrail is allowed to conclude.

### 3. Write the RED probe first

A RED probe is a focused test scenario that tries to expose the defect. It is
usually an ordinary test, not a mutation. Run it against the current
implementation before fixing anything.

Examples include passing an invalid option, supplying unavailable input, or
feeding a structured evaluator a finding it should map. The probe answers:

> Can I expose the defect?

If the probe cannot distinguish the bad behavior from the healthy behavior, the
promise is not precise enough yet.

### 4. Implement the evidence path

Build the smallest Check that can answer the promise. Keep decisions over data
separate from I/O that gathers the data. This makes the important policy easy
to test and keeps failures attributable.

When the check cannot establish the answer, return REFUSE with a diagnostic.
Do not manufacture a FAIL from an error, and do not turn missing evidence into
PASS.

### 5. Make the healthy baseline GREEN

Fix the implementation and run:

```text
redproof check
```

The command asks whether the current project satisfies the Rule. Keep working
until the intended healthy state passes. A passing Check establishes the
baseline; it does not yet prove that the guardrail is effective.

### 6. Add proof mutations

Only after the baseline is GREEN, deliberately reintroduce the defect through a
small mutation: remove a validation branch, corrupt a policy value, add a
forbidden dependency, or damage the evidence translation.

The mutation answers:

> Can I deliberately reintroduce the defect?

The mutation should be causal: it changes the behavior named by one Rule and
does not rely on an unrelated failure.

### 7. Add GREEN and REFUSE proofs

The proof portfolio should contain:

- one RED proof per Rule, showing the intended violation becomes FAIL
- one GREEN proof, showing the healthy baseline remains PASS
- one REFUSE proof, showing unavailable or untrustworthy evidence does not get
  guessed into PASS or FAIL

Then run:

```text
redproof prove
```

This applies each mutation, runs the Gate, checks the expected verdict, and
restores the workspace. It answers:

> Does the Gate catch the defect?

### 8. Verify the right scope

Use the smallest evidence that answers the promise frequently, then add slower
integration evidence where the real boundary matters:

- static structure → architecture or type Gate
- deterministic behavior → frequent contract Gate
- external tool or service behavior → slower integration Gate

Keep the layers connected by the same Rule meaning. Fast probes provide quick
feedback; real integrations prevent the probes from becoming an imitation of
the system they are meant to protect.

## The complete loop

```text
RED probe         = “Can I expose the defect?”
implementation   = “Can I fix it?”
redproof check   = “Does the healthy project pass?”
proof mutation   = “Can I deliberately reintroduce the defect?”
redproof prove   = “Does the Gate catch it?”
```

The first two lines specify and repair behavior. The last three establish that
the guardrail is healthy, sensitive to regression, and honest about uncertainty.

## What makes the method reusable

The external subject changes, but the evidence contract does not:

| Subject | Promise | Typical evidence |
| --- | --- | --- |
| Adapter | selected tool findings map to honest Rules | structured report or API result |
| API | invalid input is rejected and valid input is stable | focused request/response probes |
| Architecture | dependencies stay within approved boundaries | dependency graph or source analysis |
| Workflow | required verification steps cannot disappear | workflow and manifest inspection |
| Documentation | checked examples remain valid and debt does not grow | compiler and link checks |

The method is complete when someone reviewing the Gate can answer three
questions without guessing: what promise is protected, what evidence supports
the verdict, and what deliberate mutation proves the Rule is alive.

## Worked example

The Adapter implementation uses this method in
**[Gating Adapter contracts](adapter-contract-gates.md)**. That page records
the contract matrix, the initial RED findings, the pure-core split, and the
five-rule Gate as one concrete application of this general method.

## A medium example: harden a configured report runner

Suppose a test runner writes JSON to a configured project path. The first
version works on a clean checkout, but it can read a stale report, follow a
symlink outside the project, and leave generated directories behind. This is a
useful medium-sized improvement: it needs focused tests, a core/shell refactor,
and a Gate that keeps those contracts alive.

### 1. State the promise

“A configured report stays inside the Gate root, comes from this run, restores
the previous artifact, and removes only the directories this run created.”

This is a contract of the runner implementation. If a real run cannot satisfy
it, the runner returns `unavailable` and its Adapter returns REFUSE. FAIL is
reserved for structured tool evidence that proves a project Rule is broken.

### 2. Define the contract Rules

The meta-Gate that tests the runner has four Rules:

```ts
import { defineRules } from 'redproof';

const rules = defineRules({
  pathConfined: {
    id: 'report-runner/path-confined',
    description: 'Configured report paths stay inside the Gate root.',
  },
  fresh: {
    id: 'report-runner/fresh',
    description: 'A run never consumes a report left by an earlier run.',
  },
  restored: {
    id: 'report-runner/restored',
    description: 'A pre-existing report is restored exactly.',
  },
  clean: {
    id: 'report-runner/clean',
    description: 'The runner removes only artifacts it created.',
  },
});
```

These are not Rules exposed by the test Adapter. They are repository Rules
about the runner's implementation. That distinction keeps the verdict lanes
honest: the runner REFUSES an untrustworthy real run; its contract test exits
nonzero when that behavior regresses, so this meta-Gate FAILS.

### 3. Write the RED probes

Start with ordinary tests against the current runner. The stale-report probe
must check the returned lane and the filesystem state:

```ts
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { defineTestRunner, type TestRunner } from '@redproof/testing';

declare function withWorkspace(action: (root: string) => Promise<void>): Promise<void>;
declare function configuredReport(
  runner: TestRunner,
  options: { readonly cwd: string; readonly reportFile: string },
): TestRunner;

test('a stale report is never accepted as evidence', async () => {
  await withWorkspace(async root => {
    const reportFile = join(root, 'project/results.json');
    const capturedFile = join(root, 'captured.json');
    await mkdir(dirname(reportFile), { recursive: true });
    await writeFile(reportFile, 'stale report');

    const writesNothing = defineTestRunner({
      description: 'write no report',
      async run() {
        return { kind: 'completed', exitCode: 0, stdout: '', stderr: '' };
      },
    });
    const wrapped = configuredReport(writesNothing, {
      cwd: 'project',
      reportFile: 'results.json',
    });

    const result = await wrapped.run({ root, reportFile: capturedFile });

    assert.equal(result.kind, 'unavailable');
    assert.equal(await readFile(reportFile, 'utf8'), 'stale report');
    await assert.rejects(readFile(capturedFile), { code: 'ENOENT' });
  });
});
```

Add separate probes for a lexical `../` escape, a symlink escape, exact
restoration, cleanup of nested directories, preservation of directories that
gain other content, and a restoration error. Run them before the refactor; the
failures establish which defects actually exist.

### 4. Refactor into a functional core and imperative shell

Move path decisions into a pure module. It receives paths as values and never
touches the filesystem:

```ts
import { isAbsolute, relative, resolve, sep } from 'node:path';

export type ConfinedPath =
  | { readonly kind: 'inside'; readonly path: string }
  | { readonly kind: 'outside'; readonly path: string };

function isInside(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot !== '..'
    && !fromRoot.startsWith(`..${sep}`)
    && !isAbsolute(fromRoot);
}

export function resolveReportPath(
  root: string,
  cwd: string,
  reportFile: string,
): ConfinedPath {
  const absoluteRoot = resolve(root);
  const candidate = resolve(absoluteRoot, cwd, reportFile);
  return isInside(absoluteRoot, candidate)
    ? { kind: 'inside', path: candidate }
    : { kind: 'outside', path: candidate };
}

export function confineCanonicalPath(
  canonicalRoot: string,
  canonicalCandidate: string,
): ConfinedPath {
  return isInside(canonicalRoot, canonicalCandidate)
    ? { kind: 'inside', path: canonicalCandidate }
    : { kind: 'outside', path: canonicalCandidate };
}
```

The shell owns `lstat`, `realpath`, and mutation. It resolves the nearest
existing parent before the tool runs, uses an unpredictable backup name, and
always removes the fresh report before restoring the original:

```ts
import { randomUUID } from 'node:crypto';
import { lstat, realpath, rename, rm } from 'node:fs/promises';
import type { TestRunner, TestRunnerResult, TestRunnerUnavailable } from '@redproof/testing';

type PreparedReport = {
  readonly kind: 'prepared';
  readonly reportFile: string;
  readonly missingDirectories: readonly string[];
};

declare const ctx: { readonly root: string; readonly reportFile: string };
declare const options: { readonly cwd: string; readonly reportFile: string };
declare const runner: TestRunner;
declare function resolveReportPath(root: string, cwd: string, reportFile: string):
  | { readonly kind: 'inside'; readonly path: string }
  | { readonly kind: 'outside'; readonly path: string };
declare function prepareThroughNearestExistingParent(
  canonicalRoot: string,
  reportFile: string,
): Promise<PreparedReport | TestRunnerUnavailable>;
declare function unavailable(message: string, detail: string): TestRunnerUnavailable;
declare function copyFreshReport(
  execution: Extract<TestRunnerResult, { readonly kind: 'completed' }>,
  source: string,
  target: string,
): Promise<TestRunnerResult>;
declare function removeEmptyDirectories(directories: readonly string[]): Promise<void>;
declare function detailOf(error: unknown): string;

async function runConfiguredReport(): Promise<TestRunnerResult> {
const lexical = resolveReportPath(ctx.root, options.cwd, options.reportFile);
if (lexical.kind === 'outside') {
  return unavailable('The configured report resolves outside the Gate root.', lexical.path);
}

const prepared = await prepareThroughNearestExistingParent(
  await realpath(ctx.root),
  lexical.path,
);
if (prepared.kind === 'unavailable') return prepared;

const existing = await lstat(prepared.reportFile).catch((error: NodeJS.ErrnoException) => error);
if (existing instanceof Error && existing.code !== 'ENOENT') {
  return unavailable('The configured report could not be inspected.', existing.message);
}

const backup = existing instanceof Error
  ? null
  : `${prepared.reportFile}.redproof-backup-${randomUUID()}`;
if (backup !== null) await rename(prepared.reportFile, backup);

let outcome: TestRunnerResult;
try {
  const execution = await runner.run(ctx);
  outcome = execution.kind === 'unavailable'
    ? execution
    : await copyFreshReport(execution, prepared.reportFile, ctx.reportFile);
} catch (error) {
  outcome = unavailable('The test command failed before it reported.', detailOf(error));
}

await rm(prepared.reportFile, { force: true });
if (backup !== null) await rename(backup, prepared.reportFile);
await removeEmptyDirectories(prepared.missingDirectories);
return outcome;
}
```

The shell catches each preparation and restoration error and maps it to
`unavailable`; the shortened excerpt leaves those repetitive branches out.
The policy is now cheap to test with plain path values, while the integration
tests still exercise symlinks and real filesystem behavior.

### 5. Make the healthy baseline GREEN

Fix the implementation until every focused test passes, then put those tests
behind one frequent Gate. A command Check is appropriate because the contract
already exists as executable tests:

```ts
import { defineGate, defineProofs, defineRules, locate, mutate, proof } from 'redproof';
import { commands } from 'redproof/command';

const rules = defineRules({
  pathConfined: { id: 'report-runner/path-confined', description: 'Configured report paths stay inside the Gate root.' },
  fresh: { id: 'report-runner/fresh', description: 'A run never consumes a stale report.' },
  restored: { id: 'report-runner/restored', description: 'A pre-existing report is restored exactly.' },
  clean: { id: 'report-runner/clean', description: 'The runner removes only artifacts it created.' },
});

const tests = (pattern: string) => [
  '--disable-warning=ExperimentalWarning',
  '--experimental-strip-types',
  '--test',
  `--test-name-pattern=${pattern}`,
  'tests/report-lifecycle.test.ts',
];

const gate = defineGate({
  id: 'report-runner-contracts',
  rules,
  check: commands({
    mode: 'parallel',
    entries: [
      { rule: rules.pathConfined, command: process.execPath, args: tests('path stays confined'), timeoutMs: 5_000 },
      { rule: rules.fresh, command: process.execPath, args: tests('report is fresh'), timeoutMs: 5_000 },
      { rule: rules.restored, command: process.execPath, args: tests('original is restored'), timeoutMs: 5_000 },
      { rule: rules.clean, command: process.execPath, args: tests('created directories are cleaned'), timeoutMs: 5_000 },
    ],
  }),
});

export const proofs = defineProofs(gate, [
  proof.red(
    rules.pathConfined,
    'detects removal of canonical path confinement',
    mutate.replaceText(
      locate.text({
        files: 'src/report-path.ts',
        find: ": { kind: 'outside', path: candidate };",
        occurrence: 'last',
      }),
      ": { kind: 'inside', path: candidate };",
    ),
  ),
  proof.red(
    rules.fresh,
    'detects a stale report no longer being set aside',
    mutate.removeText(locate.text({
      files: 'src/configured-report.ts',
      find: 'if (backup !== null) await rename(prepared.reportFile, backup);\n',
    })),
  ),
  proof.red(
    rules.restored,
    'detects removal of report restoration',
    mutate.removeText(locate.text({
      files: 'src/configured-report.ts',
      find: 'if (backup !== null) await rename(backup, prepared.reportFile);\n',
    })),
  ),
  proof.red(
    rules.clean,
    'detects removal of generated-directory cleanup',
    mutate.removeText(locate.text({
      files: 'src/configured-report.ts',
      find: 'await removeEmptyDirectories(prepared.missingDirectories);\n',
    })),
  ),
  proof.refuse(
    'refuses when a contract test cannot finish',
    mutate.appendText('tests/report-lifecycle.test.ts', '\nsetInterval(() => {}, 1_000);\n'),
  ),
  proof.green('accepts the healthy report lifecycle'),
]);

export default gate;
```

Now run `redproof check`. The healthy repository passes because the four
contract commands pass. The production Adapter is not being asked to invent
lifecycle Breaches; the meta-Gate is evaluating the tests of that behavior.

### 6. Add the proof mutations

The code above gives each Rule one mutation that removes the behavior its test
protects. This is different from the earlier RED probes:

```text
RED probe       → the focused test exposes the original bug
proof mutation  → source is damaged after the fix so that test fails again
```

Avoid a mutation that merely makes TypeScript or the test process crash. It may
turn the command red, but it does not demonstrate that the named lifecycle
assertion detected its defect.

### 7. Prove GREEN and REFUSE

Run `redproof prove`. The four source mutations must FAIL their targeted Rules,
the untouched implementation must PASS, and one mutation must REFUSE. Together
they show sensitivity, a healthy baseline, and honest treatment of unavailable
evidence.

Prefer an output-budget flood over a hanging process for the REFUSE proof. A
flood refuses in well under a second, so the timeout stays free to be a generous
safety net. Set the timeout for the slowest machine that will run the Gate, not
for your own. A timeout that doubles as a speed budget makes a slow shared
machine report a refusal that no defect caused.

### 8. Verify the right scope

Run the pure path tests and focused lifecycle Gate frequently. Keep at least one
slower integration fixture with the real test tool, because command arguments,
tool-specific report behavior, symlinks, and cleanup races exist only at that
boundary. The two layers protect the same promise without asking the fast Gate
to imitate the external tool.
