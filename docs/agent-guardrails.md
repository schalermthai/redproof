# Guardrails for agent-written code

A coding agent writes code fast. In one pass it can change source files,
configuration, and documentation. It can also make a mistake in each of them
at the same speed. So the checks that run after each change matter more, not
less. The agent reads a failed check and fixes the code. That loop only works
when the check still fails on a real mistake.

This page covers four things. Why a rule written as a prompt does not hold.
When an agent should run `redproof check` and `redproof prove`. The Stop hook
this repository ships for Claude Code. And the two skills under
[`skills/`](../skills) that teach an agent the same discipline by hand.

- [A prompt alone does not hold](#a-prompt-alone-does-not-hold)
- [Run check at the end of a turn](#run-check-at-the-end-of-a-turn)
- [The Stop hook](#the-stop-hook)
- [The redproof skill](#the-redproof-skill)
- [The redproof-pr-review skill](#the-redproof-pr-review-skill)
- [How the three fit together](#how-the-three-fit-together)

## A prompt alone does not hold

Most teams write their guardrails as prose. The rules go into a `CLAUDE.md`
file, a system prompt, or a contributing guide. The agent reads them once at
the start of a session. Then it works.

An agent does not follow prose for a whole session. It drifts. It skips a rule
to finish a task. It forgets a rule after a long tool output. When the context
window fills up, the early instructions are the first to lose weight. The
agent does not announce the drift. It reports that the task is done.

These are rules from this repository that an agent will likely miss when
written as a prompt:

```text
Core modules must not import node:fs or node:child_process.
Import another context only through its index.ts.
Do not call process.cwd() inside a core module.
Every ts code block in the docs must compile.
Do not mark a test .skip to make the run green.
Do not leave an export that nothing imports.
Add every new package to scripts/set-version.ts.
```

Each rule is short and clear. Each one is also easy to break without noticing.
A new import looks like every other import. A `.skip` is one word. A missed
package is an absence, and an absence is invisible in a diff.

So this repository does not keep these rules as prose. Each one is a Rule in a
Gate. The architecture Gate holds the first three. The static-contracts,
test-health, unused-code, and repository-policy Gates hold the other four. A
Gate reads the files after every turn. It does not read a prompt, and it does
not forget.

The Stop hook below closes the loop. When the agent ends a turn, the hook runs
every Gate. A breach comes back to the agent as a Rule name and a location, and
the turn stays open until the agent fixes it. The drift is corrected in the
same turn, not found in review a day later.

A Gate can also stop working without anyone noticing. A file pattern no longer
matches a new directory, or a tool crashes and the script that reads its output
reports success. The RED proofs catch that. Each one plants a known mistake and
expects the Gate to fail. The [Redproof proves Redproof](red-proving-redproof.md)
page shows the 61 proofs this repository keeps for its own six Gates.

## Run check at the end of a turn

Run `redproof check` when the agent ends a turn, for example from a Stop hook.
In this repository the full check takes about 16 seconds. Do not run it after
every file edit. Run `redproof prove` in CI, and run it for one Gate file when
the agent has edited that file:

```bash
npx redproof prove gates/architecture.ts
```

## The Stop hook

This repository ships the hook for Claude Code in
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

The hook exits 0 when every Gate passes, and the turn ends. When a Gate
fails, the hook prints the Redproof report to stderr and exits 2. Exit 2 keeps
the turn open and hands the report to the agent, so it sees the breached Rule
and its location. The first line reads the `stop_hook_active` field. When that
field is true, the hook exits at once, so a blocked stop does not run the check
a second time.

## The redproof skill

A Gate is a proof that repeats on every commit. Most checks an agent writes in
a day are not Gates. They are a new test, a lint rule, a CI step, or an
assertion in a script. The [`redproof`](../skills/redproof/SKILL.md) skill
teaches the agent to prove one of those by hand, once, before it trusts it.
The skill works with or without the Redproof library. It needs only a check
that can go red and a file the agent can change and restore.

The proof is not the point. What the agent builds on afterwards is the point.
An agent that trusts an unproven check builds on an assumption. An agent that
has seen the check go red for the right rule builds on a fact. Every decision
after that rests on evidence, not on the word "pass".

The skill starts with a question: is a proof owed? A proof is owed only when
both answers are yes.

```text
Q1  the guard is unproven to you
Q2  a blind pass would be quiet
```

Most work fails Q1. The agent did not write or change the check. Of the work
that passes Q1, much fails Q2. A compile error or a crash at start is loud, and
the world already reports it. The default answer is no, and the skill says so
in its first section. It is loaded often and most loads end with no proof.

When both answers are yes, the agent runs the loop. State the rule in one
sentence. Plan the restore. Choose the smallest break. Break the thing being
checked, never the check. Run the same check. Confirm red, and confirm that the
message names the rule. Restore. Run the check again and confirm green. Report
both results:

```text
Red-proof: <the rule, in one sentence>
  break     <file:line, and what changed>
  red       <the output line that named the rule>
  restore   <how, and confirmed clean>
  green     <the check passing again>
```

An example from a run. A fresh agent got the three skill files as its only
instructions and a small Node project with no Redproof dependency. The project
has `applyDiscount(totalCents, percent)`, which clamps the percent to the range
0 to 100, and two passing tests. The task was to add a test for the clamp at
100 percent. The agent added the test, and the suite passed on the first run
with 3 tests. Then it applied the two questions. Q1 was yes, because it wrote
the test after the code existed and never saw it go red. Q2 was yes, because
a broken clamp would return a negative total and nothing else in the project
would report it. So it ran the loop and broke the function, not the test:

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

The red named the new test only. The two existing tests stayed green during
the break. The agent now knows the test detects the bug it names, and the next
change can build on that.

Two reference files sit beside the skill.
[`breaking.md`](../skills/redproof/breaking.md) says how to choose a break that
proves the right thing, and lists six more ways a check goes blind.
[`verdicts.md`](../skills/redproof/verdicts.md) holds 33 worked verdicts for
borderline cases.

When the project uses the Redproof library, the skill does three things
differently. First, the agent asks the Check what it inspected before it plants
a break. `redproof check --reporter=json --outputFile=out.json` writes a scan
with an `inspected` count. Zero means the check is blind, and no break is
needed. Redproof refuses that PASS on its own with the `nothing-inspected`
diagnostic. Second, when a Redproof Proof already targets the Rule, no proof by
hand is owed. That proof runs on every commit, so the agent runs
`redproof prove` for the Gate instead of repeating the loop. Third, when the
guard is permanent, the agent stores the break beside the Gate as a
`proof.red`. The loop then repeats on every commit, and the check cannot go
blind next month without anyone noticing.

## The redproof-pr-review skill

The [`redproof-pr-review`](../skills/redproof-pr-review/SKILL.md) skill applies
the same discipline at review time. It reads a pull request as a set of claims,
not as a diff.

A code change is not proof that the intended outcome happened. A passing test
is not proof that the test can detect the failure it guards against. So the
skill starts with the PR description, separates the goal from the
implementation, and lists the claims worth checking. For each important claim
the agent asks what observable condition would have to be true, and then tries
to disprove it. Where no evidence is available, such as a claim about
production latency, the agent reports the claim as unverified and says what
evidence would be needed. The skill also treats the reviewer's own suggestions
as claims. A suggested refactor is tested in a separate worktree before it is
recommended.

An example from a run. A fresh agent got the skill file as its only
instruction and a small Node project with two branches. The pull request
branch moves a save call out of the domain module into the application
service and injects a repository. The one existing test passes on both
branches. The PR description makes three claims, and the agent listed them:

```text
C1  The order domain no longer depends on infrastructure.
C2  Existing behaviour is unchanged. All tests pass.
C3  placeOrder can be tested without the database by passing a fake repository.
```

C1 was false on purpose. The change removed the database import from the
domain module but left a second import from the same infrastructure folder.
The diff looks clean and the test is green, so a reviewer who reads only the
diff accepts it. The agent did not know this. It read the diff, then checked
the claim against the repository and reported:

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

For C2 and C3 the agent made a worktree, planted one fault per claim, and
read the result. For C2 it removed the `repository.save(order)` line. The
existing test went from `pass 1` to `fail 1`, and back to `pass 1` after the
revert. For C3 it wrote a test with a fake repository, then made `placeOrder`
ignore the injected repository. That test went red, `actual: 0, expected: 1`,
and green again after the revert. Both worktrees were removed and nothing was
committed.

The agent also listed four risks it did not turn into findings. One of them is
the reason the false claim survived the author's own test run: no check in the
project goes red when the domain imports infrastructure. The suggestion under
C1 is that check. It is a Gate.

## How the three fit together

```text
redproof skill             one proof, by hand, for a check you just wrote or changed
redproof-pr-review skill   proofs for the claims a pull request makes, at review time
Redproof library           a proof stored beside the Gate, repeated on every commit
```

The skills teach the discipline. The library makes it permanent.

Claude Code loads a skill from a `SKILL.md` file under `.claude/skills/` in a
project, or under `~/.claude/skills/` for every project. Copy the skill
directory there to use it.

## Next

- **[Redproof proves Redproof](red-proving-redproof.md)** for the six Gates
  and their patterns.
- **[The Contract-to-Gate method](contract-to-gate.md)** to turn a quality idea
  into a Rule, a Check, and Proofs.
