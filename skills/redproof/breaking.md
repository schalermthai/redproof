# Breaking well

How to choose a break that proves the right thing. Read this at step 3 of the
loop.

- [Six more ways a check goes blind](#six-more-ways-a-check-goes-blind)
- [Ask the check what it inspected](#ask-the-check-what-it-inspected)
- [The smallest break, per guard](#the-smallest-break-per-guard)
- [The scope-change trap](#the-scope-change-trap)
- [Reading the red](#reading-the-red)
- [Two worked proofs](#two-worked-proofs)

## Six more ways a check goes blind

`SKILL.md` names the four quiet shapes. These six are the rest.

1. **The assertion is empty.** The test asserts that a value is defined, or that
   a list has a length, and nothing more.
2. **The test is off.** Someone wrote `.skip`, `xit`, or `@Ignore`. Or an
   `.only` elsewhere in the file hides the rest.
3. **The rule is off.** A severity moved to `warn`. A rule left the config. A
   file joined the ignore list.
4. **A mock answers the question.** The test asserts on the value the mock
   supplied. The real code never decides anything.
5. **The check runs on the wrong build.** The artifact under test does not
   contain the change. A stale `dist` directory is the common case.
6. **A snapshot was updated blind.** The recorded output now matches the new
   wrong behaviour.

## Ask the check what it inspected

Before you plant a break, ask whether the check looked at anything. This is
faster than a proof, and it answers the most common blindness on its own.

A Redproof Check reports the count directly:

```bash
redproof check --reporter=json --outputFile=out.json
```

Every Check result carries a `scan` with an `inspected` count. The ESLint
adapter sets it to the number of linted files, at
`packages/eslint/src/index.ts`. An `inspected` value of zero is the answer. The
check is blind, and no break is needed. Redproof refuses that PASS on its own
with the `nothing-inspected` diagnostic. A Gate that sets
`policies: { emptyEvidence: 'allow' }` keeps the PASS, so read that policy as a claim to
verify.

Other tools expose the same thing under other names. A test count, a file count,
a duration. When the number is zero, stop and fix the check.

## The smallest break, per guard

**Unit or integration test.** Break the code under test. Do not break the test.
Change one returned value, one boundary, or one branch. Expect one named test to
fail.

**Assertion inside product code.** Feed the input the assertion rejects. Do not
delete the assertion. A deleted assertion proves the assertion exists, not that
it fires.

**Lint rule.** Add one line that the rule forbids. Put it in a file the rule
covers. Read the ignore list first.

**Type check.** Assign a wrong type at one call site. Do not use a cast and do
not use `any`. Both hide the error you want to see.

**Architecture or dependency rule.** Add one forbidden import. Keep the code
valid so it still compiles. A compile error would mask the real result.

**Schema or contract check.** Send one payload with one field wrong. Missing,
wrong type, or out of range. Change one field, not three.

**CI step.** Break the thing the step guards, on a branch. Watch the job go red.
Do not edit the workflow file to force a failure. That proves the workflow runs.
It does not prove the guard detects.

**Alert or health check.** Make the watched dependency unavailable, in a test
environment. Confirm the alert fires and names the right condition.

**Mutation score gate.** Weaken or delete one test. Do not touch the source.
Confirm the score drops below the minimum.

**Characterization suite.** Change the legacy output the suite records. Confirm
the named test fails. Then prove the skip rule too. Turn one test into a skipped
test and confirm the gate notices. A skipped test is the most common way a
safety net stops working.

**Coverage threshold.** Delete a test that covers a branch. Confirm the check
fails. Do not lower the threshold.

## The scope-change trap

You changed a glob, a path, or an ignore list. The break must go where **only
the new scope reaches**.

A break inside both the old scope and the new scope goes red either way. That
red proves the rule works. It proves nothing about the change you made.

A scope change has two halves, so prove both. Prove them one at a time.

1. **The new scope is watched.** Plant the break at a path only the new scope
   covers. Expect red. Restore.
2. **The old scope was dropped on purpose.** Plant the break at the old path.
   Expect green. Restore.

The second pass turns an assumption into a decision.

## Reading the red

- The message must name your rule, your file, and your break.
- One failure is strong evidence. Forty failures are weak evidence. Aim for one.
- A compile error is not a proof. Choose a break that still compiles.
- If the check failed before it reached your break, the proof is void. Fix the
  break and run again.
- If the check went red for a different rule, the proof is void. The rule you
  targeted is still unproven.
- A REFUSE is not a red. It means the Check could not decide. Treat it as an
  unknown, never as a pass.

## Two worked proofs

### A new lint rule

The rule: source files must not call `console.log`.

```text
break     src/order.ts:12, added `console.log('x');`
red       src/order.ts:12:1  error  Unexpected console statement  no-console
restore   removed line 12; git status clean
green     0 problems
```

The red names `no-console` and names the file. That is a proof.

If the red had said `no-unused-vars`, the proof would be void.

### An architecture rule

The rule: domain code must not import infrastructure code.

```text
break     src/domain/order.ts, added `import '../infrastructure/db.js';`
red       error domain-no-infrastructure: src/domain/order.ts -> src/infrastructure/db.js
restore   removed the import; git status clean
green     no dependency violations found
```

The import is valid code, so the file still compiles. The rule engine, not the
compiler, produced the red.
