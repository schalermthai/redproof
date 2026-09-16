# Guardrails for agent-written code

A coding agent is an AI tool that edits code and runs commands for you. It
changes source files, configuration, and documentation in one pass. It makes
mistakes at the same speed. So the checks that run after each change matter
more, not less. That only works when a check still fails on a real mistake.

- [Why a rule in a prompt does not hold](#why-a-rule-in-a-prompt-does-not-hold)
- [When to run check and prove](#when-to-run-check-and-prove)
- [The Stop hook](#the-stop-hook)
- [The redproof skill](#the-redproof-skill)
- [The redproof-pr-review skill](#the-redproof-pr-review-skill)
- [How the three fit together](#how-the-three-fit-together)

## Why a rule in a prompt does not hold

Most teams write their guardrails as prose. The rules go into a `CLAUDE.md`
file, a system prompt, or a contributing guide. The agent reads them once at
the start of a session.

An agent does not follow prose for a whole session. It skips a rule to finish
a task, or forgets one after a long tool output. When its context window
fills up, the early instructions lose weight first. The context window is the
amount of text the agent can hold at one time. The agent does not announce
the drift. It reports that the task is done.

Here are seven rules from this repository. An agent will likely miss each one
when it reads them as a prompt:

```text
Core modules must not import node:fs or node:child_process.
Import another context only through its index.ts.
Do not call process.cwd() inside a core module.
Every ts code block in the docs must compile.
Do not mark a test .skip to make the run green.
Do not leave an export that nothing imports.
Add every new package to scripts/set-version.ts.
```

Each rule is easy to break without noticing. A new import looks like every
other import. A `.skip` is one word. A missed package is an absence, and an
absence is invisible in a diff.

So it is better to convert these proses into a Redproof Gate, where each policy 
can be grouped as a rule within the Gate. We can define as many logical Gates 
as we need.

The [Redproof proves Redproof](red-proving-redproof.md) page showcases the
different proofs this repository maintains for its six Gates.

## When to run check and prove

Run `redproof check` when the agent ends a turn. A turn is one round of agent work. 
In this repository, the full check takes about 16 seconds, so do not run it after
every file edit.


Run `redproof prove` in CI. Also run it for a specific Gate file when the agent has
edited that file:

```bash
npx redproof prove gates/architecture.ts
```

You can also ask the agent to harden any guardrails by prompting it to review the
relevant Gate, identify weak or missing rules, and improve them until the proof
passes reliably.

## The Stop hook

A hook is a command that Claude Code runs at a fixed point in its work. The
Stop hook runs when the agent ends a turn. This repository ships one in
[`.claude/settings.json`](../.claude/settings.json):

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "timeout": 120,
            "command": "input=$(cat); case \"$input\" in *'\"stop_hook_active\":true'*|*'\"stop_hook_active\": true'*) exit 0;; esac; out=$(npm run -s self:check 2>&1) && exit 0; printf '%s\\n' \"$out\" >&2; exit 2"
          }
        ]
      }
    ]
  }
}
```

The script runs `npm run -s self:check`. When every Gate passes, it exits 0
and the turn ends. When a Gate fails, it prints the report to stderr and exits
2. Exit 2 keeps the turn open and hands the report to the agent. The agent
sees the broken Rule and its location, and fixes it in the same turn.

The first part of the script reads `stop_hook_active`. When that field is true,
the hook exits at once, so a blocked stop does not run the check twice.

## The redproof skill

The [`redproof`](../skills/redproof/SKILL.md) skill teaches the agent to prove
a check by hand once before trusting it. A check can be a new test, a lint
rule, a CI step, or an assertion in a script. The skill works with or without
the Redproof library. It only needs a check that can fail and a file the agent
can change and restore.

The important part is what the agent builds on afterward. An agent that trusts
an unproven check builds on an assumption. An agent that has seen the check fail
for the right reason builds on a fact.

The skill first asks whether a proof is owed. A proof is owed only when both
answers are yes:

```text
Q1  the guard is unproven to you
Q2  a blind pass would be quiet
```

The guard is the check the agent is about to trust. It is unproven when the
agent has never seen it fail. A blind pass is a green result from a check
that can no longer detect the problem. Quiet means that nothing else would
report the problem.

Most work fails Q1 because the agent did not write or change the check. So the
default answer is no.

When the guard is unproven and the agent is about to build on that assumption, it runs the loop:

```text
1  state the rule in one sentence
2  plan the restore
3  choose the smallest break, in the code and never in the check
4  run the same check and confirm it fails for that rule
5  restore
6  run the check again and confirm it passes
7  report both results
```

Here is a real example.

A fresh agent was given the Redproof skill files and a small Node.js project. The project did not use the Redproof library.

The project had a function called `applyDiscount(totalCents, percent)`. It makes sure the discount percentage stays between 0 and 100. The project already had two passing tests.

The agent's task was to add a new test for a discount percentage above 100. The new test checks that the function treats any value above 100 as 100. After adding the test, all 3 tests passed.

But a passing test is not enough by itself. The agent had never seen this new test fail, so it did not yet know whether the test could actually catch the bug it was meant to detect.

To prove that, the agent temporarily changed the implementation from a maximum of 100 to a maximum of 200. It then ran the same test suite again:

```text
Red-proof: a percent above 100 must be clamped to 100 before the discount is applied
  break     src/discount.js:10, changed `Math.min(100, Math.max(0, percent))` to `Math.min(200, Math.max(0, percent))`
  red       ✖ clamps a percent above 100 to 100 (0.324375ms)
            AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
            -500 !== 0
            at test/discount.test.js:14:10
  restore   git checkout -- src/discount.js; git status --short src/discount.js is empty
  green     ✔ clamps a percent above 100 to 100 (0.041708ms); tests 3, pass 3, fail 0
```

The new test failed when the bug was introduced. The agent then restored the original implementation and confirmed that all 3 tests passed again.

That proves one thing: the new test can detect the bug it claims to guard against.


The agent changed one number on line 10, from 100 to 200. The new test failed
with `-500 !== 0`, while the two existing tests stayed green. The agent then
restored the file and confirmed that all 3 tests passed.

It now knows one fact: the new test detects the bug it names.

When the project uses the Redproof library, the skill does three things
differently:

```text
1  run  redproof check --reporter=json --outputFile=out.json  and read the inspected count first;
   zero means the check is blind, and Redproof refuses that PASS as nothing-inspected
2  when a Proof already targets the Rule, run  redproof prove  instead of the loop by hand
3  when the guard is permanent, store the break beside the Gate as a proof.red
```


## The redproof-pr-review skill

The [`redproof-pr-review`](../skills/redproof-pr-review/SKILL.md) skill reviews
a pull request as a set of claims, not just as a diff. A claim is a statement
about what the change is supposed to achieve.

A code change is not proof that the intended outcome happened. Likewise, a
passing test is not proof that the test can detect the failure it is meant to
guard against.

The agent reads the PR description, lists its claims, and tries to disprove
each important one. If there is not enough evidence to verify a claim, such as
a claim about production latency, the agent reports it as unverified.

The agent also treats its own suggestions as claims. Before recommending a
change, it tests that change in a worktree. A worktree is a separate checkout
of the same repository in its own directory.

Here is a real example.

A fresh agent was given the skill file and a small Node.js project with two
branches. The PR branch moves a save call out of the domain module and into the
application service. It also changes the service so a repository can be passed
in.

The project has one test, and that test passes on both branches. The PR
description makes three claims:

```text
C1  The order domain no longer depends on infrastructure.
C2  Existing behaviour is unchanged. All tests pass.
C3  placeOrder can be tested without the database by passing a fake repository.
```

C1 was intentionally false. The PR removed the database import from the domain
module, but another import from the same infrastructure folder was still there.
The diff looked clean and the test still passed, so the problem was easy to
miss.

The agent checked the claim against the repository and reported:

```text
Claim: C1  The order domain no longer depends on infrastructure
Verdict: Not proven. Counterexample found.
Severity: Blocking

Evidence (branch decouple-domain):
src/domain/order.js:1:import { nowIso } from '../infrastructure/clock.js';

Impact:
The PR removes one of two domain -> infrastructure edges. The main claim, as
written, is false.

Suggestion:
Pass the timestamp, or a clock function, into createOrder from placeOrder.
Add a check that fails when src/domain imports src/infrastructure, so this
cannot return.
```

For C2 and C3, the agent introduced one temporary fault per claim in a
worktree.

For C2, it removed the `repository.save(order)` line. The existing test changed
from `pass 1` to `fail 1`. After restoring the line, the test passed again.
This showed that the existing test could detect that behavior changing.

For C3, the agent added a test that passed a fake repository to `placeOrder`.
It then temporarily changed `placeOrder` so that it ignored the fake
repository. The new test failed with `actual: 0, expected: 1`. After restoring
the code, the test passed again.

The agent removed both worktrees and committed nothing.

It also listed four risks. One of them explained why the false C1 claim
survived the author's own test run: the project had no check that failed when
code in `src/domain` imported code from `src/infrastructure`.

The suggestion under C1 asks for exactly that kind of check.

That check is a Gate.

## How the three fit together

```text
redproof skill             one proof, by hand, for a check you just wrote or changed
redproof-pr-review skill   proofs for the claims a pull request makes, at review time
Redproof library           a proof stored beside the Gate, repeated on every commit
```

The skills teach the discipline by hand. The library makes the proof
permanent. Claude Code loads a skill from a `SKILL.md` file under
`.claude/skills/` in a project, or under `~/.claude/skills/` for every
project. Copy the skill directory there to use it.

## Next

- **[Redproof proves Redproof](red-proving-redproof.md)** for the six Gates
  and their patterns.
- **[The Contract-to-Gate method](contract-to-gate.md)** to turn a quality idea
  into a Rule, a Check, and Proofs.
