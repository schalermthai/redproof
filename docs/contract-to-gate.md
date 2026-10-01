# The Contract-to-Gate Method

Use the Contract-to-Gate method when you have an important engineering expectation that should become a reliable Redproof guardrail.

For example:

- an architecture boundary must not be crossed
- a release must include every workspace package
- an Adapter must refuse when its evidence cannot be trusted
- an API must reject invalid input
- a workflow must always run required verification
- documentation examples must continue to compile

The method turns that expectation into something Redproof can continuously verify.

The basic flow is:

```text
Promise
  ↓
Rule
  ↓
Check
  ↓
Healthy baseline
  ↓
RED proof
```

Or, in one sentence:

> Define what must remain true, decide what evidence proves it, then prove that the Gate detects when it becomes false.

---

## The method at a glance

| Step | Question |
| --- | --- |
| 1. State the promise | What must remain true? |
| 2. Define the Rule | What exactly counts as PASS, FAIL, or REFUSE? |
| 3. Reproduce the defect | Can we demonstrate the bad behavior? |
| 4. Implement the evidence path | How will the Gate determine the result? |
| 5. Make the baseline GREEN | Does the healthy project pass? |
| 6. Add a RED proof | Can we deliberately break the promise? |
| 7. Add GREEN and REFUSE proofs | Does the Gate behave correctly in healthy and uncertain states? |
| 8. Verify the scope | Are we testing the right thing at the right layer? |

You do not need to design the entire Gate up front.

Start with one promise and one observable failure.

---

### 1. State the promise

Write one sentence describing something that must remain true.

Avoid vague goals such as:

```text
The integration should be robust.
```

Prefer something observable:

```text
An unavailable dependency refuses without changing the project.
```

Or:

```text
A release contains every package in the workspace.
```

Or:

```text
The domain layer never imports infrastructure code.
```

A useful promise is narrow enough that another developer can tell whether it holds.

Also decide what is **not** part of the promise.

For example:

> "The domain layer never imports infrastructure code."

does not necessarily mean:

> "The entire architecture is correct."

Keeping the boundary small makes Rules easier to understand, test, and maintain.

---

### 2. Define the Rule and its verdicts

Turn the promise into a Redproof Rule with a stable identity.

For example:

```ts
import { defineRules } from 'redproof';

const rules = defineRules({
  domainBoundary: {
    id: 'architecture/domain-boundary',
    description: 'The domain layer does not depend on infrastructure.',
  },
});
```

Then decide what each verdict means.

### PASS

The available evidence shows that the Rule holds.

Example:

```text
No domain module imports infrastructure.
```

### FAIL

The evidence shows that the Rule is broken.

Example:

```text
src/domain/order.ts imports src/infrastructure/database.ts.
```

### REFUSE

Redproof cannot safely determine whether the Rule holds.

Examples:

```text
The dependency report is missing.
The external tool failed to start.
The report is malformed.
The evidence is contradictory.
```

This distinction is important.

A broken Rule is a `FAIL`.

Broken or untrustworthy evidence is usually a `REFUSE`.

Do not turn an infrastructure error into a Rule violation, and do not turn missing evidence into `PASS`.

Configuration that is invalid before the Gate can run should normally be treated as a configuration error.

---

### 3. Reproduce the defect first

Before building the Gate, make sure you can demonstrate the behavior you want to prevent.

This is the initial **RED probe**.

It is usually an ordinary test or focused scenario rather than a Redproof mutation.

For example, if your promise is:

```text
A configured report must never read stale output from a previous run.
```

create a test that:

1. writes an old report
2. runs a command that produces no new report
3. verifies that the old report is not accepted as new evidence

Run that test against the current implementation.

The important question is:

> Can I expose the defect?

If you cannot clearly demonstrate the bad behavior, the promise may still be too vague.

---

### 4. Implement the evidence path

Now implement the smallest Check that can answer the Rule.

A useful design is to separate:

```text
decision logic
```

from:

```text
I/O used to collect evidence
```

For example:

```text
filesystem / process / API
          ↓
      evidence
          ↓
   pure decision logic
          ↓
PASS / FAIL / REFUSE
```

This makes the policy easier to test and keeps failures easier to understand.

For a path-containment Rule, for example, the pure part might decide:

```ts
import { isAbsolute, relative, resolve, sep } from 'node:path';

function isInside(root: string, candidate: string): boolean {
  const fromRoot = relative(resolve(root), resolve(candidate));
  return fromRoot !== '..'
    && !fromRoot.startsWith(`..${sep}`)
    && !isAbsolute(fromRoot);
}
```

while another layer handles:

```text
realpath
symlinks
filesystem reads
process execution
```

The Check should report a Breach only when the evidence proves that the Rule was violated; Redproof turns that evidence into `FAIL`.

If it cannot establish a trustworthy answer, report a refusal diagnostic so Redproof returns `REFUSE`.

---

### 5. Make the healthy baseline GREEN

Once the implementation is fixed, run:

```bash
npx redproof check
```

The healthy project should pass.

Conceptually:

```text
healthy repository
       ↓
     Check
       ↓
      PASS
```

This establishes the baseline.

However, a passing Gate only establishes, within the Check’s inspected scope:

> The project currently satisfies the Rule.

It does **not** yet prove:

> The Gate would detect the Rule being broken.

That is what the next step is for.

---

## 6. Add a RED proof

Now deliberately break the behavior protected by the Rule.

For example:

```ts
import { mutate, proof } from 'redproof';
import { defineRules } from 'redproof';

const rules = defineRules({
  domainBoundary: {
    id: 'architecture/domain-boundary',
    description: 'Domain code does not depend on infrastructure.',
  },
});

proof.red(
  rules.domainBoundary,
  'detects domain depending on infrastructure',
  mutate.appendText(
    'src/domain/order.ts',
    '\nimport "../infrastructure/database";\n',
  ),
)
```

The mutation should cause the specific Rule you are proving to fail.

Think of it as asking:

> Can I deliberately reintroduce the defect?

A good mutation is **causal**.

It changes the behavior named by the Rule rather than causing some unrelated failure.

For example, avoid proving an architecture Rule by introducing a TypeScript syntax error.

The Gate may fail, but the architecture Check did not actually demonstrate that it can detect the architecture defect.

---

## 7. Add GREEN and REFUSE proofs

A useful proof set normally includes three kinds of evidence.

### RED

Shows that the Gate detects a violation.

```ts
import { mutate, proof } from 'redproof';
import { defineRules } from 'redproof';

const rules = defineRules({
  domainBoundary: {
    id: 'architecture/domain-boundary',
    description: 'Domain code does not depend on infrastructure.',
  },
});

proof.red(
  rules.domainBoundary,
  'detects a forbidden dependency',
  mutate.appendText('src/domain/order.ts', '\nimport "../infrastructure/database";\n'),
)
```

For Rules that protect different behaviors, aim for one focused RED proof per Rule.

### GREEN

Shows that the healthy repository is accepted.

```ts
import { proof } from 'redproof';

proof.green('accepts the healthy architecture')
```

### REFUSE

Shows that Redproof does not invent an answer when the evidence becomes unavailable or unsafe to trust.

```ts
import { mutate, proof } from 'redproof';

proof.refuse(
  'refuses when dependency evidence cannot be produced',
  mutate.move('.dependency-cruiser.cjs', '.dependency-cruiser.off.cjs'),
)
```

Then run:

```bash
npx redproof prove
```

By default, Redproof applies proof mutations in temporary project copies, runs the Gate, and checks the expected verdicts. In-place execution restores the workspace afterward.

The important distinction is:

```text
npx redproof check
```

asks:

> Does the project satisfy the Rules right now?

while:

```text
npx redproof prove
```

asks:

> Does the Gate actually detect the failures it claims to protect against?

---

## 8. Verify the scope

Not every part of a contract should run at the same frequency.

Use the cheapest reliable evidence for frequent feedback, then keep slower integration coverage where the real system boundary matters.

For example:

| Behavior | Useful evidence |
| --- | --- |
| static architecture | dependency or source analysis |
| deterministic logic | focused tests |
| type contracts | compiler |
| external tool integration | real tool invocation |
| external service behavior | integration test |
| release contents | manifest or artifact inspection |

A common structure is:

```text
fast focused test
       +
real integration test
```

The fast layer provides quick feedback.

The integration layer verifies that your model of the external system still matches reality.

Both should protect the same promise.

---

## RED probe vs RED proof

These two ideas are related but happen at different times.

### RED probe

Used while discovering or fixing the defect.

```text
Can I reproduce the problem?
```

Example:

```text
Create a stale report and verify that the current runner incorrectly reads it.
```

### RED proof

Used after the implementation has been fixed.

```text
Can I deliberately break the fix and verify that the Gate detects it?
```

Example:

```text
Remove the code that clears the stale report and verify that the Rule FAILS.
```

The lifecycle is:

```text
RED probe
    ↓
Expose the defect

Implementation
    ↓
Fix the defect

npx redproof check
    ↓
Confirm the healthy project passes

Proof mutation
    ↓
Reintroduce the defect

npx redproof prove
    ↓
Confirm the Gate catches it
```

This distinction prevents an easy mistake: proving that a test can fail rather than proving that the intended contract is actually protected.

---

## A small example

Suppose you want to protect this architecture contract:

> The domain layer must not import infrastructure code.

### 1. Name the policy

If you were writing a custom Check, you could define the Rule yourself:

```ts
import { defineRules } from 'redproof';

const rules = defineRules({
  domainBoundary: {
    id: 'architecture/domain-boundary',
    description: 'Domain code does not depend on infrastructure.',
  },
});
```

### 2. Implement the Check

For this example, use dependency-cruiser instead. The Adapter supplies its own
Rule as `adapter.rules.domainBoundary`; the manually defined Rule above is
not needed. Your `.dependency-cruiser.cjs` must define the selected
`domain-no-infrastructure` rule, and both imported source files must exist.

```ts
import { dependencyCruiser } from '@redproof/dependency-cruiser';

const adapter = dependencyCruiser({
  configFile: '.dependency-cruiser.cjs',
  files: ['src'],
  rules: {
    domainBoundary: 'domain-no-infrastructure',
  },
});
```

### 3. Create the Gate

```ts
import { dependencyCruiser } from '@redproof/dependency-cruiser';

const adapter = dependencyCruiser({
  configFile: '.dependency-cruiser.cjs',
  files: ['src'],
  rules: {
    domainBoundary: 'domain-no-infrastructure',
  },
});
import { defineGate } from 'redproof';

const gate = defineGate({
  id: 'architecture',
  adapter,
});
```

### 4. Verify the healthy baseline

Run:

```bash
npx redproof check
```

The healthy architecture should pass.

### 5. Prove the Rule

Deliberately introduce the forbidden dependency:

```ts
import { dependencyCruiser } from '@redproof/dependency-cruiser';

const adapter = dependencyCruiser({
  configFile: '.dependency-cruiser.cjs',
  files: ['src'],
  rules: {
    domainBoundary: 'domain-no-infrastructure',
  },
});
import { defineGate } from 'redproof';

const gate = defineGate({ id: 'architecture', adapter });

import { defineProofs, mutate, proof } from 'redproof';

export const proofs = defineProofs(gate, [
  proof.red(
    adapter.rules.domainBoundary,
    'detects domain depending on infrastructure',
    mutate.appendText(
      'src/domain/order.ts',
      '\nimport "../infrastructure/database";\n',
    ),
  ),

  proof.green('accepts the healthy architecture'),
]);

export default gate;
```

Save the complete Gate as `gates/architecture.ts`:

```ts
import { dependencyCruiser } from '@redproof/dependency-cruiser';
import { defineGate, defineProofs, mutate, proof } from 'redproof';

const adapter = dependencyCruiser({
  configFile: '.dependency-cruiser.cjs',
  files: ['src'],
  rules: { domainBoundary: 'domain-no-infrastructure' },
});

const gate = defineGate({ id: 'architecture', adapter });

export const proofs = defineProofs(gate, [
  proof.red(
    adapter.rules.domainBoundary,
    'detects domain depending on infrastructure',
    mutate.appendText(
      'src/domain/order.ts',
      '\nimport "../infrastructure/database";\n',
    ),
  ),
  proof.green('accepts the healthy architecture'),
]);

export default gate;
```

With `redproof`, `@redproof/dependency-cruiser`, and `dependency-cruiser`
installed, and a Redproof config that includes `gates/**/*.ts`, run:

```bash
npx redproof check gates/architecture.ts
npx redproof prove gates/architecture.ts
```

This example proves detection for one Rule. Add a REFUSE proof that prevents
dependency evidence from being produced to cover that lane too.

You now have both sides of the contract:

```text
Healthy architecture
        ↓
      PASS

Forbidden dependency added
        ↓
      FAIL
```

That is the core Contract-to-Gate loop.

---

## A larger example: protecting a report runner

The same method works for implementation contracts that are more complicated than an architecture rule.

Suppose a runner asks an external tool to write a report to a configured path.

You want this promise:

> A configured report stays inside the Gate root, comes from the current run, restores any previous artifact, and cleans up only files or directories created by the run.

That promise can be separated into four Rules:

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

Notice that these Rules describe the **runner implementation**.

They are different from Rules exposed by the testing Adapter to users.

That distinction matters.

A production Adapter might behave like this:

```text
report cannot be trusted
        ↓
      REFUSE
```

But the repository Gate protecting the implementation might behave like this:

```text
contract test detects regression
        ↓
       FAIL
```

Those are different contracts at different layers.

### First, reproduce each defect

Add focused tests for cases such as:

```text
../ path escape
symlink escape
stale report
incorrect restoration
unsafe cleanup
restoration failure
```

Run those tests before fixing the implementation.

That establishes which defects actually exist.

### Then separate policy from I/O

Keep path-policy decisions in pure functions when possible. This example checks lexical containment; the surrounding I/O must also check
canonical paths resolved through existing parents to detect symlink escapes:

```ts
import { isAbsolute, relative, resolve, sep } from 'node:path';

function isInside(root: string, candidate: string): boolean {
  const fromRoot = relative(resolve(root), resolve(candidate));
  return fromRoot !== '..'
    && !fromRoot.startsWith(`..${sep}`)
    && !isAbsolute(fromRoot);
}

export function resolveReportPath(root: string, cwd: string, reportFile: string) {
  const candidate = resolve(root, cwd, reportFile);
  return isInside(root, candidate)
    ? { kind: 'inside' as const, path: candidate }
    : { kind: 'outside' as const, path: candidate };
}
```

Keep filesystem operations such as:

```text
lstat
realpath
rename
rm
```

in the surrounding I/O layer.

This makes the policy cheap to test while keeping integration tests for filesystem-specific behavior such as symlinks.

### Put the contract tests behind a Gate

If the contract already exists as executable tests, a command Check can be enough.
The example repeats the Rules and defines a test selector so it compiles on its
own. Adapt the test-file path and name patterns to your project.
Ensure each selector actually runs an assertion; an exit code alone cannot
establish that a test-name filter matched anything.

```ts
import { defineGate } from 'redproof';
import { commands } from 'redproof/command';
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
const tests = (pattern: string) => [
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
      {
        rule: rules.pathConfined,
        command: process.execPath,
        args: tests('path stays confined'),
      },

      {
        rule: rules.fresh,
        command: process.execPath,
        args: tests('report is fresh'),
      },

      {
        rule: rules.restored,
        command: process.execPath,
        args: tests('original is restored'),
      },

      {
        rule: rules.clean,
        command: process.execPath,
        args: tests('created directories are cleaned'),
      },
    ],
  }),
});
```

### Add focused proof mutations

Each Rule should have a mutation that removes the behavior protecting it.
The example repeats the Rules and imports so it compiles on its own. It assumes
that the selected source text exists exactly once in your implementation.

For example:

```ts
import { locate, mutate, proof } from 'redproof';
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
proof.red(
  rules.restored,
  'detects removal of report restoration',
  mutate.removeText(
    locate.text({
      files: 'src/configured-report.ts',
      find: 'if (backup !== null) await rename(backup, prepared.reportFile);\n',
    }),
  ),
)
```

That mutation directly removes the behavior named by `restored`.

Avoid mutations that only make the program crash or fail to compile. They can make the command exit unsuccessfully without demonstrating that the contract assertion detected its intended defect.

Finally include:

```ts
import { proof } from 'redproof';

proof.green('accepts the healthy report lifecycle')
```

and a REFUSE proof that makes the evidence unavailable, such as exceeding a
configured command output limit. Keep timeouts generous enough for slower
machines rather than using them as speed budgets.

Then run:

```bash
npx redproof prove
```

The resulting Gate demonstrates:

```text
each contract regression → FAIL
healthy implementation   → PASS
untrustworthy evidence    → REFUSE
```

---

## Applying the method to different problems

The subject changes, but the structure stays the same.

| Subject | Example promise | Typical evidence |
| --- | --- | --- |
| Adapter | Selected tool findings map to the correct Rules | structured report or API result |
| API | Invalid input is rejected | request/response tests |
| Architecture | Dependencies remain inside approved boundaries | dependency graph |
| Workflow | Required verification cannot disappear | workflow inspection |
| Configuration | Invalid combinations are rejected | configuration tests |
| Documentation | Checked examples remain valid | compiler, command, or link check |
| Release | Required packages are present | artifact or manifest inspection |

For each one, ask:

```text
What must remain true?
What evidence can establish it?
What should happen when that evidence cannot be trusted?
How can I deliberately violate the promise?
```

If those questions have clear answers, you probably have enough information to build the Gate.

---

## When is the Gate finished?

A reviewer should be able to answer these questions without guessing:

1. **What promise does this Rule protect?**
2. **What evidence determines PASS, FAIL, or REFUSE?**
3. **What deliberate mutation proves the Rule can detect a regression?**

If those answers are clear, the Gate is doing more than checking the current repository.

It is protecting a contract.

---

## Related guides

- [Built-in Adapters](./built-in-adapters.md) — turn results from supported tools into Rules.
- [Command Checks](./commands.md) — use executable commands as evidence.
- [Custom Adapters](./custom-adapter.md) — build an integration when an existing Adapter is not enough.
- [Gating Adapter contracts](./adapter-contract-gates.md) — a larger real-world application of this method.
