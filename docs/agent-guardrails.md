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

Two reference files sit beside the skill.
[`breaking.md`](../skills/redproof/breaking.md) says how to choose a break that
proves the right thing, and lists six more ways a check goes blind.
[`verdicts.md`](../skills/redproof/verdicts.md) holds 33 worked verdicts for
borderline cases.

## The redproof-pr-review skill

The [`redproof-pr-review`](../skills/redproof-pr-review/SKILL.md) skill applies
the same discipline at review time. It reads a pull request as a set of claims,
not as a diff.

A code change is not proof that the intended outcome happened. A passing test
is not proof that the test can detect the failure it guards against. So the
skill starts with the PR description, separates the goal from the
implementation, and lists the claims worth checking:

```text
C1  Domain no longer imports infrastructure.
C2  Existing API behavior remains compatible.
C3  Retry logic cannot produce duplicate processing.
```

For each important claim the agent asks what observable condition would have to
be true, and then tries to disprove it. Where a Gate exists, the agent plants
the smallest fault, confirms the Gate goes red for that claim, reverts, and
confirms green. Where no evidence is available, such as a claim about
production latency, the agent reports the claim as unverified and says what
evidence would be needed. The skill also treats the reviewer's own suggestions
as claims. A suggested refactor is tested in a separate worktree before it is
recommended.

## How the three fit together

```text
redproof skill             one proof, by hand, for a check you just wrote or changed
redproof-pr-review skill   proofs for the claims a pull request makes, at review time
Redproof library           a proof stored beside the Gate, repeated on every commit
```

The skills teach the discipline. The library makes it permanent. When a
hand-made proof is for a guard that will stay, the `redproof` skill says to
move it into a Gate, so the check cannot go blind next month without anyone
noticing.

Claude Code loads a skill from a `SKILL.md` file under `.claude/skills/` in a
project, or under `~/.claude/skills/` for every project. Copy the skill
directory there to use it.

## Next

- **[Redproof proves Redproof](red-proving-redproof.md)** for the six Gates
  and their patterns.
- **[The Contract-to-Gate method](contract-to-gate.md)** to turn a quality idea
  into a Rule, a Check, and Proofs.
