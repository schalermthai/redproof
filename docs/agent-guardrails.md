# Guardrails for agent-written code

A coding agent is an AI tool that edits code and runs commands for you. It
writes code fast. In one pass it can change source files, configuration, and
documentation. It can also make a mistake in each of them at the same speed.
So the checks that run after each change matter more, not less. The agent
reads a failed check and fixes the code. That loop only works when the check
still fails on a real mistake.

This page covers four things. First, why a rule written as a prompt does not
hold. Second, when an agent should run `redproof check` and `redproof prove`.
`redproof check` runs the Gates against the current project. `redproof prove`
runs the proofs, which show that each Gate can still fail.

Third, the Stop hook this repository ships for Claude Code. A hook is a
command that Claude Code runs at a fixed point in its work. The Stop hook runs
when the agent ends a turn. A turn is one round of agent work. It starts when
the agent receives a message and ends when the agent stops to report. Fourth,
the two skills under [`skills/`](../skills) that teach an agent the same
discipline by hand. A skill is a file of instructions that an agent loads when
a task needs them.

- [Why a rule in a prompt does not hold](#why-a-rule-in-a-prompt-does-not-hold)
- [When to run check and prove](#when-to-run-check-and-prove)
- [The Stop hook](#the-stop-hook)
- [The redproof skill](#the-redproof-skill)
- [The redproof-pr-review skill](#the-redproof-pr-review-skill)
- [How the three fit together](#how-the-three-fit-together)

## Why a rule in a prompt does not hold

Most teams write their guardrails as prose. The rules go into a `CLAUDE.md`
file, a system prompt, or a contributing guide. The agent reads them once at
the start of a session. Then it works.

An agent does not follow prose for a whole session. It drifts. It skips a rule
to finish a task. It forgets a rule after a long tool output. The context
window is the amount of text the agent can hold at one time. When the context
window fills up, the early instructions are the first to lose weight. The
agent does not announce the drift. It reports that the task is done.

Here are seven rules from this repository. An agent will likely miss each of
them when it reads them as a prompt:

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

So this repository does not keep these rules as prose. It keeps each one as a
Rule in a Gate. A Rule is one policy statement, such as the first line in the
list above. A Gate is one guardrail. It holds one or more Rules and one Check.
A Check is the code that reads the repository and decides whether each Rule
holds. The architecture Gate holds the first three rules in the list. The
static-contracts, test-health, unused-code, and repository-policy Gates hold
the other four. A Gate reads the files after every turn. It does not read a
prompt, and it does not forget.

The Stop hook, described below, closes the loop. When the agent ends a turn,
the hook runs every Gate. When a Rule is broken, the Gate reports a breach. A
breach names the Rule and the location in the code. The breach comes back to
the agent, and the turn stays open until the agent fixes it. The agent
corrects the drift in the same turn. Nobody finds it in review a day later.

A Gate can also stop working without anyone noticing. For example, a file
pattern no longer matches a new directory. Or a tool crashes, and the script
that reads its output reports success. The RED proofs catch that. A RED proof
plants one known mistake in the code and expects the Gate to fail. When the
Gate still passes, the proof fails, and the team learns that the Gate is
blind. The [Redproof proves Redproof](red-proving-redproof.md) page shows the
61 proofs this repository keeps for its own six Gates.

## When to run check and prove

Run `redproof check` when the agent ends a turn. The Stop hook in the next
section is one way to do that. In this repository the full check takes about
16 seconds. So do not run it after every file edit. Run `redproof prove` in
CI. Also run it for one Gate file when the agent has edited that file. For
example, after the agent edits the architecture Gate, run:

```bash
npx redproof prove gates/architecture.ts
```

## The Stop hook

This repository ships its hook for Claude Code in
[`.claude/settings.json`](../.claude/settings.json). Below is the hook as it
appears in that file. The `command` field holds one shell script. The script
reads its input, runs `npm run -s self:check`, and then exits with a code. The
exit code decides what Claude Code does next.

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

The hook has two outcomes. When every Gate passes, the hook exits 0, and the
turn ends. When a Gate fails, the hook prints the Redproof report to stderr
and exits 2. Exit 2 keeps the turn open and hands the report to the agent. So
the agent sees the breached Rule and its location.

There is one more detail. The first part of the script reads the
`stop_hook_active` field from the input. When that field is true, the hook
exits at once. This means a stop that the hook already blocked does not run
the check a second time.

## The redproof skill

A Gate keeps its proof in code, so the proof repeats on every commit. Most
checks an agent writes in a day are not Gates. They are a new test, a lint
rule, a CI step, or an assertion in a script. The
[`redproof`](../skills/redproof/SKILL.md) skill teaches the agent to prove
one of those by hand, once, before it trusts it. The skill works with or
without the Redproof library. It needs only two things. The first is a check
that can go red. Red means the check fails. Green means the check passes. The
second is a file the agent can change and restore.

The proof itself is not the goal. The goal is what the agent builds on
afterwards. An agent that trusts an unproven check builds on an assumption.
An agent that has seen the check go red for the right rule builds on a fact.
Every decision after that rests on evidence, not on the word "pass".

The skill starts with a question: is a proof owed? Owed means the agent must
do the proof before it goes on. The skill answers this with two smaller
questions. A proof is owed only when both answers are yes.

```text
Q1  the guard is unproven to you
Q2  a blind pass would be quiet
```

In these questions, the guard is the check the agent is about to trust. The
first question asks whether the agent has ever seen that guard go red. If it
has not, the guard is unproven. The second question asks whether a blind pass
would be quiet. A blind pass is a green result from a check that can no
longer detect the problem. Quiet means nothing else in the project would
report the problem either.

Most work fails the first question, because the agent did not write or change
the check. Of the work that passes the first question, much fails the second.
A compile error or a crash at start is loud. The world already reports it. So
the default answer is no. The skill says so in its first section. Agents load
the skill often, and most loads end with no proof.

When both answers are yes, the agent runs the loop. The loop has these steps.
State the rule in one sentence. Plan how to restore the file. Choose the
smallest break. Break the thing being checked, never the check itself. Run
the same check. Confirm that it goes red. Confirm that the message names the
rule. Restore the file. Run the check again and confirm that it goes green.
Then report both results in this form:

```text
Red-proof: <the rule, in one sentence>
  break     <file:line, and what changed>
  red       <the output line that named the rule>
  restore   <how, and confirmed clean>
  green     <the check passing again>
```

Each line of the report has a fixed meaning. The `break` line says which file
and line changed, and what changed. The `red` line quotes the output line
that named the rule. The `restore` line says how the agent restored the file
and how it confirmed the file is clean. The `green` line shows the check
passing again.

Here is an example from a real run. A fresh agent got the three skill files as
its only instructions. It also got a small Node project with no Redproof
dependency. The project has a function `applyDiscount(totalCents, percent)`.
The function clamps the percent to the range 0 to 100. To clamp means to push
a value inside a range. So a percent above 100 becomes 100. The project also
has two passing tests. The task was to add a test for the clamp at 100
percent.

The agent added the test. The suite passed on the first run with 3 tests.
Then the agent applied the two questions. The first question is whether the
guard is unproven to the agent. The answer was yes. The agent wrote the test
after the code existed, so it never saw the test go red. The second question
is whether a blind pass would be quiet. The answer was also yes. A broken
clamp would return a negative total, and nothing else in the project would
report that. Both answers were yes, so a proof was owed. The agent ran the
loop. It broke the function, not the test. This is its report:

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

Read the `break` line first. The agent changed one number on line 10 of
`src/discount.js`. The upper bound of the clamp went from 100 to 200. Then
read the `red` line. The new test failed with `-500 !== 0`. The function
returned -500 where the test expected 0. The `restore` line shows that the
agent restored the file with `git checkout`. It then confirmed with
`git status` that no change remained. The `green` line shows all 3 tests
passing again.

The red named the new test only. The two existing tests stayed green during
the break. So the agent now knows one fact. The new test detects the bug it
names. The next change can build on that fact.

Two reference files sit beside the skill.
[`breaking.md`](../skills/redproof/breaking.md) says how to choose a break that
proves the right thing, and lists six more ways a check goes blind.
[`verdicts.md`](../skills/redproof/verdicts.md) holds 33 worked verdicts for
borderline cases. A verdict is the decision the skill reaches for one case,
with the reasons for it.

When the project uses the Redproof library, the skill does three things
differently.

First, the agent asks the Check what it inspected before it plants a break.
The command `redproof check --reporter=json --outputFile=out.json` writes the
result as JSON. The result includes a scan, and the scan has an `inspected`
count. That count says how many items the Check looked at. Zero means the
check is blind, and no break is needed to show that. Redproof refuses that
PASS on its own. A REFUSE is a third verdict beside PASS and FAIL. It means
the Check ran, but its evidence cannot be trusted. Here the REFUSE carries the
`nothing-inspected` diagnostic. A diagnostic is the message that explains a
REFUSE.

Second, a Redproof Proof may already target the Rule. In that case no proof
by hand is owed. That Proof runs on every commit. So the agent runs
`redproof prove` for the Gate instead of repeating the loop.

Third, when the guard is permanent, the agent stores the break beside the
Gate as a `proof.red`. A `proof.red` is a RED proof written in code next to
the Gate definition. The loop then repeats on every commit. The check cannot
go blind next month without anyone noticing.

## The redproof-pr-review skill

The [`redproof-pr-review`](../skills/redproof-pr-review/SKILL.md) skill applies
the same discipline at review time. It reads a pull request as a set of
claims, not as a diff. A claim is a statement about what the change achieves.
"All tests pass" is a claim. "The domain no longer depends on infrastructure"
is a claim.

A code change is not proof that the intended outcome happened. A passing test
is not proof that the test can detect the failure it guards against. So the
skill starts with the PR description. It separates the goal from the
implementation. Then it lists the claims worth checking. For each important
claim, the agent asks what observable condition would have to be true. Then
it tries to disprove that condition. Sometimes no evidence is available. A
claim about production latency is one example. Then the agent reports the
claim as unverified and says what evidence would be needed. The skill also
treats the reviewer's own suggestions as claims. A suggested refactor is
tested in a separate worktree before the agent recommends it. A worktree is a
second checkout of the same git repository in its own directory. The agent
can change files there without touching the main checkout.

Here is an example from a real run. A fresh agent got the skill file as its
only instruction. It also got a small Node project with two branches. The pull
request branch moves a save call out of the domain module into the
application service. It also injects a repository. To inject means to pass
the repository in from outside instead of importing it inside the module. The
one existing test passes on both branches. The PR description makes three
claims. The agent listed them like this:

```text
C1  The order domain no longer depends on infrastructure.
C2  Existing behaviour is unchanged. All tests pass.
C3  placeOrder can be tested without the database by passing a fake repository.
```

The first claim was false on purpose. The change removed the database import
from the domain module. But it left a second import from the same
infrastructure folder. The diff looks clean and the test is green. So a
reviewer who reads only the diff accepts it. The agent did not know about the
planted fault. It read the diff. Then it checked the claim against the
repository. This is its report for the first claim. Look at the `Evidence`
line. It quotes the import that remains:

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

The report has five parts. The `Verdict` says the claim is not proven and a
counterexample exists. A counterexample is one concrete case that shows the
claim is false. The `Severity` line marks this finding as Blocking. The
`Evidence` quotes line 1 of `src/domain/order.js`. That line imports `nowIso`
from the infrastructure folder. The `Impact` says the PR removed one of two
domain to infrastructure edges, so the claim is false as written. The
`Suggestion` gives two actions. Pass the timestamp, or a clock function, into
`createOrder`. And add a check that fails when the domain imports
infrastructure.

For the second and third claims, the agent used worktrees. It planted one
fault per claim and read the result. For the second claim, it removed the
`repository.save(order)` line. The existing test went from `pass 1` to
`fail 1`. After the revert, it went back to `pass 1`. So the existing test
can detect that fault. For the third claim, the agent wrote a test with a
fake repository. Then it made `placeOrder` ignore the injected repository.
That test went red with `actual: 0, expected: 1`. After the revert, it went
green again. Both worktrees were removed, and nothing was committed.

The agent also listed four risks that it did not turn into findings. One of
them explains why the false claim survived the author's own test run. No
check in the project goes red when the domain imports infrastructure. The
suggestion under the first claim asks for exactly that check. That check is
one Rule and a Check that fails when the Rule is broken. That is what a Gate
is.

## How the three fit together

```text
redproof skill             one proof, by hand, for a check you just wrote or changed
redproof-pr-review skill   proofs for the claims a pull request makes, at review time
Redproof library           a proof stored beside the Gate, repeated on every commit
```

The two skills teach the discipline by hand. The library stores the proof
beside the Gate, so the proof becomes permanent.

Claude Code loads a skill from a `SKILL.md` file. The file lives under
`.claude/skills/` in a project, or under `~/.claude/skills/` for every
project. Copy the skill directory there to use it.

## Next

- **[Redproof proves Redproof](red-proving-redproof.md)** for the six Gates
  and their patterns.
- **[The Contract-to-Gate method](contract-to-gate.md)** to turn a quality idea
  into a Rule, a Check, and Proofs.
