# Worked verdicts

Calibration for the two questions in `SKILL.md`. Read this when a case feels
borderline.

- [The default answer](#the-default-answer)
- [Worked verdicts](#worked-verdicts)
- [Budget rules](#budget-rules)
- [Stop and ask first](#stop-and-ask-first)

## The default answer

The default answer is no.

An agent that red-proofs everything is useless. It is slow. It edits code it
should not touch. It turns a five-minute task into an hour.

The two questions form an AND gate.

```text
Q1  the guard is unproven to you
Q2  a blind pass would be quiet
```

Most work fails at Q1. Of the work that passes Q1, much fails at Q2.

## Worked verdicts

| Situation | Owed? | Why |
| --- | --- | --- |
| "Run the tests." | No | Never-prove list. Report the result. Offer the proof in one line. |
| "Fix this date format bug." | No | Q1. Feature code is not a guard. |
| You added a regression test first and watched it fail. | No | The red already happened. Do not repeat it. |
| You added a regression test after the fix and it passed at once. | Yes | Q1 yes, and a weak test prints green forever. |
| You added a CLI flag and one unit test for it. The test passes. | No | Q2. If the flag broke, the terminal would show wrong output. That is loud. |
| You added a new lint rule to the config. | Yes | A rule that matches no file passes forever and looks healthy. |
| You changed a lint rule severity from error to warn. | Yes | Q1 by the touching list. The gate may now pass on real findings. |
| You bumped the linter version. | No | Q1. You changed a dependency, not a guard. |
| You wrote a test that mocks the function it is testing. | Yes | The classic blind test. Break the real function and watch. |
| You added an assertion to an existing passing test. | Yes | Q2. A weak assertion is invisible. Break the value it reads. |
| You renamed a test file. | No | Q1. The guard did not change. |
| You deleted a file nothing imports. | No | Q1, but confirm first that it was not a test the runner collected. |
| You added a CI step that runs a script. | Yes | Q2. A script that always exits 0 looks exactly like a healthy step. |
| You added a step with `continue-on-error: true`. | Yes | It can never fail the build. Confirm the user wants that. |
| You added a CI job that runs a vulnerability audit. | Owed, cannot prove | Q1 and Q2 both yes. The only break is a package with a known fault, which edits the lock file. State the limit. |
| You raised a flaky test's timeout from 5s to 10s. | Owed, often cannot prove | Q1 by the touching list. A slow regression now hides. You cannot break "slow" cheaply. State the limit. |
| You added a health check or an alarm. | Yes | Q2. An alarm with no data source is silent forever. |
| You added an input validation rule. | Yes | Q2. Send the bad input. Confirm it is rejected. |
| You added an architecture or dependency rule. | Yes | Q2. A rule with a wrong path glob matches nothing. |
| You changed a rule's file glob for a workspace move. | Yes | Q1 by the touching list. Read the scope-change trap in `breaking.md`. |
| You added a coverage threshold. | Yes | Q2. Confirm the number can drop below the line. |
| You raised the coverage threshold from 80 to 85. | No | The gate already proved it can fail. |
| You edited a test's expected value to match your new output. | Yes | Q1 by the touching list. The test may now record the wrong answer. |
| You added a null guard. The existing test passed before and after. | Yes | Q1 by the touching list. A test that cannot tell the two states apart does not cover the case. |
| A script printed `Checked 0 items` and exited 0. | No proof | The check already confessed. Say it is blind. Fix it. |
| You are reading someone else's test to understand it. | No | Q1. You claim nothing about it. |
| You are about to rely on a teammate's gate you never saw go red. | Yes | Q1 by the touching list. A PASS is the only evidence on offer. |
| You are about to say "this is covered by tests". | Yes | That sentence is the claim. Prove it or soften it. |
| You are about to say "the fix is verified". | Yes | Same. Name what you actually ran instead. |
| You are about to say a gate "protects" or "prevents" something. | Yes | A claim about what a gate covers. Prove it, or name what you actually ran. |
| A Redproof Proof already targets this Rule. | No | The proof runs on every commit. Run it, do not repeat it by hand. |
| You reformatted a test file. | No | Q1. No behaviour changed. |
| The break would touch production or a shared database. | No | Never. Say what you cannot prove and why. |

## Budget rules

- One red-proof per guard. Not one per assertion.
- Prove the claim that matters most. Skip the rest and name what you skipped.
- Time cap: if the break plus the restore takes more than a few minutes, ask.
- Batch cap: if a change adds more than three guards, prove the two highest risk
  ones.
- Never red-proof while the baseline is red. Get it green first, or the proof
  means nothing.
- A generated or copied check counts as new. You did not watch it fail.
- Prove a guard after a large refactor is green, not during it.

## Stop and ask first

- The break would touch a file outside your current change.
- The break would touch a system you do not control.
- The working tree is dirty in the file you must break.
- You cannot describe the exact restore.
- The check is slow and you would run it three times.
- The user asked for speed. Offer in one line, do not perform.
