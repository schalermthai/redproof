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

So this repository keeps each rule as a Rule in a Gate. A Rule is one policy
statement. A Gate is one guardrail. It holds Rules and one Check. A Check is
the code that reads the repository and decides whether each Rule holds.

The architecture Gate holds the first three rules above. Four other Gates hold the
rest. A Gate reads the files after every turn. It does not forget.

A Gate can also stop working without anyone noticing. A file pattern no longer
matches a new directory, or a tool crashes and its wrapper reports success.
RED proofs catch that. A RED proof plants one known mistake and expects the
Gate to fail. The [Redproof proves Redproof](red-proving-redproof.md) page
shows the 61 proofs this repository keeps for its six Gates.

## When to run check and prove

`redproof check` runs the Gates against the current project. `redproof prove`
runs the proofs, which show that each Gate can still fail.

Run `redproof check` when the agent ends a turn. A turn is one round of agent
work. In this repository the full check takes about 16 seconds. Do not run it
after every file edit. Run `redproof prove` in CI. Also run it for one Gate
file when the agent has edited that file:

```bash
npx redproof prove gates/architecture.ts
```

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

A skill is a file of instructions that an agent loads when a task needs them.
The [`redproof`](../skills/redproof/SKILL.md) skill teaches the agent to prove
a check by hand, once, before it trusts it. A check here is a new test, a lint
rule, a CI step, or an assertion in a script. The skill works with or without
the Redproof library. It needs a check that can fail and a file the agent can
change and restore.

The point is what the agent builds on afterwards. An agent that trusts an
unproven check builds on an assumption. An agent that has seen the check fail
for the right reason builds on a fact.

The skill first asks whether a proof is owed. A proof is owed only when both
answers are yes:

```text
Q1  the guard is unproven to you
Q2  a blind pass would be quiet
```

The guard is the check the agent is about to trust. It is unproven when the
agent has never seen it fail. A blind pass is a green result from a check
that cannot detect the problem any more. Quiet means nothing else would report
the problem. Most work fails Q1, because the agent did not write or change the
check. So the default answer is no.

When both answers are yes, the agent runs the loop:

```text
1  state the rule in one sentence
2  plan the restore
3  choose the smallest break, in the code and never in the check
4  run the same check, and confirm it fails for that rule
5  restore
6  run the check again, and confirm it passes
7  report both results
```

Here is a report from a real run. A fresh agent got the skill files and a
small Node project with no Redproof dependency. The project has
`applyDiscount(totalCents, percent)`, which limits the percent to the range 0
to 100, and two passing tests. The task was to add a test for the limit at
100 percent. The agent added the test, and the suite passed with 3 tests.
Both answers were yes, so it ran the loop:

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

The agent changed one number on line 10, from 100 to 200. The new test failed
with `-500 !== 0`. The two existing tests stayed green. The agent restored the
file and saw 3 tests pass. It now knows one fact: the new test detects the bug
it names.

Two reference files sit beside the skill.
[`breaking.md`](../skills/redproof/breaking.md) says how to choose a break and
lists six more ways a check goes blind.
[`verdicts.md`](../skills/redproof/verdicts.md) holds 33 worked verdicts for
borderline cases.

When the project uses the Redproof library, the skill does three things
differently:

```text
1  run  redproof check --reporter=json --outputFile=out.json  and read the inspected count first;
   zero means the check is blind, and Redproof refuses that PASS as nothing-inspected
2  when a Proof already targets the Rule, run  redproof prove  instead of the loop by hand
3  when the guard is permanent, store the break beside the Gate as a proof.red
```

## The redproof-pr-review skill

The [`redproof-pr-review`](../skills/redproof-pr-review/SKILL.md) skill
reviews a pull request as a set of claims, not as a diff. A claim is a
statement about what the change achieves. A code change is not proof that the
outcome happened. A passing test is not proof that the test can detect the
failure it guards against.

The agent reads the PR description, lists the claims, and tries to disprove
each important one. When no evidence is available, such as a claim about
production latency, it reports the claim as unverified. It treats its own
suggestions as claims too, and tests them in a worktree first. A worktree is a
second checkout of the same repository in its own directory.

Here is a report from a real run. A fresh agent got the skill file and a
small Node project with two branches. The PR branch moves a save call out of
the domain module into the application service and injects a repository. The
one test passes on both branches. The PR description makes three claims:

```text
C1  The order domain no longer depends on infrastructure.
C2  Existing behaviour is unchanged. All tests pass.
C3  placeOrder can be tested without the database by passing a fake repository.
```

C1 was false on purpose. The change removed the database import from the
domain but left a second import from the same folder. The diff looks clean
and the test is green. The agent did not know this. It checked the claim
against the repository and reported:

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

For C2 and C3 the agent planted one fault per claim in a worktree. For C2 it
removed the `repository.save(order)` line. The existing test went from
`pass 1` to `fail 1`, and back after the revert. For C3 it wrote a test with a
fake repository, then made `placeOrder` ignore it. That test failed with
`actual: 0, expected: 1`, and passed again after the revert. It removed both
worktrees and committed nothing.

The agent also listed four risks. One explains why the false claim survived
the author's own test run. No check in the project fails when the domain
imports infrastructure. Its suggestion under C1 asks for that check. That
check is a Gate.

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
