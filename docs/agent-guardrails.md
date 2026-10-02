# Guardrails for Agent-Written Code

Coding agents can make large changes quickly.

They can also miss an instruction, cross an architecture boundary, skip a test, or make a change that satisfies the immediate task while violating a project invariant.

Redproof gives the agent executable feedback from the repository itself.

There are two pieces you can use together:

```text
Redproof as a library (Rules, Gates, Checks, Proofs)

Redproof as a agent plugin (skills + completion hook)
```

The library defines and evaluates your project guardrails.

The plugin helps coding agents discover, design, build, challenge, and use those guardrails during their normal workflow.

The plugin is optional. You can use Redproof without an agent plugin, and you can even install the plugin before a project has any Gates.

---

## Install the Redproof agent plugin

Redproof publishes an agent plugin for Codex and Claude Code.

Plugin 0.2.0 installs:

- the `/discover` skill
- the `/design` skill
- the `/build` skill
- the `/challenge` skill
- the `/review-pr` skill
- a completion-time Stop hook for Claude Code

It does **not** install the Redproof npm library or any of your project's checking tools. Those remain normal project dependencies.

### Codex

```bash
codex plugin marketplace add schalermthai/redproof --ref plugin-marketplace
codex plugin add redproof@redproof-plugins
```

If your Codex version does not provide `plugin add`, add the marketplace first and install Redproof from the plugin browser.

### Claude Code

```bash
claude plugin marketplace add 'schalermthai/redproof#plugin-marketplace'
claude plugin install redproof@redproof-plugins --scope user
```

Use `--scope local` instead if you want it only for you in the current project.

---

## Where the plugin fits

A typical project has three layers:

```text
project tools (Vitest / ESLint / dependency-cruiser / scripts)
        ↓
Redproof library (Rules / Gates / Checks / Proofs)
        ↓
Redproof agent plugin (skills + lifecycle integration

```

The project tools produce evidence.

The Redproof library turns that evidence into stable project contracts.

The agent plugin helps an agent work with those contracts.

That separation is important.

Installing the plugin does not automatically create Gates.

Installing the npm library does not automatically integrate with your coding agent.

You can adopt either piece independently.

---

## Start with the plugin if you do not know what to protect

If you are adopting Redproof in an existing project, a good first step is the `discover` skill.

In Codex, select Redproof's `discover` skill.

In Claude Code, use:

```text
/redproof:discover
```

Then ask something like:

```text
Find the important promises this project makes.
Show where our existing checks might miss a regression,
and let me choose what to protect first.
```

The plugin can inspect the project, identify candidate guardrails, and propose Gate designs.

The intended flow is:

```text
Discover
    ↓
choose Gates
    ↓
Design
    ↓
approve implementation
    ↓
Build and prove
```

Choosing a Gate authorizes design work. Implementation requires its own approval.
Discovery and design use a local interactive report, with chat as a fallback.
The report helper needs Node.js 24+ and a local browser. Unanswered choices
authorize no work; local implementation does not authorize CI changes or publication.

---

## The published skills

You can start at whichever stage matches what you already know.

### `/discover`

Use `/discover` when you want to know:

> What important promises in this project deserve stronger protection?

Typical candidates include:

```text
architecture boundaries
release requirements
test-health expectations
package relationships
documentation guarantees
security-sensitive invariants
```

The skill looks for important project promises and places where existing checks may not detect a realistic regression.

---

### `/design`

Use `/design` when you already know what you want to protect.

For example:

```text
Design a Gate that ensures the domain package
never imports application infrastructure.
```

The skill helps work out:

| Item | Description |
|---|---|
| **Rule identity** | The rule the guardrail is intended to enforce |
| **Evidence source** | The information used to evaluate the rule |
| **Scope** | Where the rule applies |
| **PASS / FAIL / REFUSE behavior** | How the guardrail responds to each outcome |
| **Proof strategy** | How to verify that the guardrail actually detects violations |

It designs the guardrail without implementing it yet.

---

### `/build`

Use `/build` once you have an approved Gate design.

For example:

```text
Implement the approved architecture Gate
and prove that it catches the regression.
```

The build workflow can implement the Gate, run its proofs, restore temporary faults, and report the result or blockers.

You can also ask it to assess an existing Gate without repairing it.

---

### `/challenge`

Use `/challenge` when a safeguard already exists and you want to know:

> Does it actually catch the defect it claims to catch?

For example:

```text
Does our architecture check catch a forbidden import?
Test it once and restore the project afterward.
```

The workflow temporarily introduces the defect, runs the same safeguard, restores
the project, and confirms that the safeguard passes again. A proof is owed when
the guard is unproven to the agent and a blind pass would be quiet. Ordinary
edits do not automatically require a fault experiment. When an existing Redproof
Proof already targets the Rule, run `redproof prove` instead of repeating the
experiment by hand.

This is especially useful for:

```text
new regression tests
repository scripts
architecture rules
existing Gates
```

---

### `/review-pr`

Use `/review-pr` when reviewing a change based on the claims it makes.

For example:

```text
Does this PR actually deliver its claim
that exports preserve every row?
```

Instead of only inspecting the diff, the workflow asks:

```text
What does the PR claim?

What evidence supports it?

What would falsify the claim?

Which existing guardrails can test it?
```

This is useful for large agent-generated changes where the visible diff may not tell you whether the intended contract actually holds.

---

## The Claude Code Stop hook

Plugin 0.2.0 and later include a Stop hook for Claude Code. Codex does not load this plugin's hooks yet.

A Stop hook runs when the agent tries to end a turn.

Redproof uses that lifecycle point to run the project's existing Gates automatically.

Conceptually:

```text
agent tries to finish
        ↓
Redproof Stop hook
        ↓
project's redproof check
        ↓
PASS
  → turn can finish

FAIL
  → Gate report goes back to the agent
  → agent fixes the problem

REFUSE
  → evidence problem goes back to the agent
```

The hook uses the Redproof installation already present in your project.

It does not download Redproof or install dependencies. It invokes the project's
checks, which may produce artifacts according to their own behavior. The hook
needs Git and the Node.js version required by your installed Redproof library
on the session's `PATH`. Without Node.js, the host reports a hook error and
nothing is checked. The hook was developed against Redproof 0.12.0; that is
not a guarantee of compatibility with every library version.

---

### The hook only checks relevant work

The hook is designed to avoid blindly running every Gate after every turn.

It uses Git to find files changed since the agent session started, committed or
not. The nearest Redproof config above a changed file owns that file. Git-ignored
files are outside this change tracking.

Only the owning configs are checked, but each runs its full configured Gate
catalogue. An unchanged turn does not trigger a Stop check; the separate
session-start baseline can still run.

Conceptually:

```text
changed files
    ↓
find owning Redproof config
    ↓
run relevant Gates
```

This keeps the completion check closer to the work the agent actually performed.

---

### Existing failures do not have to block unrelated work

A project may already have failing Gates before the agent starts.

At session start, the hook silently checks configs within a shared 15-second
budget and records known, located Breaches from completed checks. Without a
completed baseline or a source location, failures remain blocking.

If the agent does not touch the affected source, Gate, or config, those known failures can remain warnings instead of blocking unrelated work.

That avoids a common problem with repository-wide agent hooks:

```text
existing unrelated failure
        ↓
agent can never finish any task
```

while still surfacing the existing problem as a warning, not a passing result.
New Breaches still block. Changing the affected source, Gate, or config retires
the corresponding exemption; a successful check also clears old exemptions.

---

### The hook does not silently pretend everything passed

In a project without a Redproof config, the hook stays silent. If relevant work
has a config but no installed Redproof library, it warns once per session that
the Gates are unverified and lets the turn end.

It does not install anything automatically.

If an installed check crashes, times out, or returns REFUSE, the hook blocks
once per session, then warns that verification could not be established. REFUSE
remains unverified even if the project config gives it exit code zero.

A failed Gate can block three checks in one turn before the hook lets the turn
end with a warning. An unchanged previously failing tree also warns without
rerunning. These limits allow work to finish; they do not establish a pass.

This preserves an important distinction:

```text
PASS
the project satisfied the Gate

FAIL
the evidence shows a Rule was violated

unverified / REFUSE
the check could not establish the result
```

---

### Configure or disable the hook

Set `REDPROOF_STOP_HOOK=off` to disable it for one shell. For one project, add
`redproof.stop-hook.json` at the repository root:

```json
{ "enabled": false }
```

To skip configs used as fixtures, the same file accepts:

```json
{ "ignore": ["fixtures/**"] }
```

This repository also has a separate local Stop hook in
[`.claude/settings.json`](../.claude/settings.json), which runs `npm run -s self:check`.
The plugin hook is disabled here to avoid duplicate checks. If your project
already has a local hook, keep one active check path.

---

## What the plugin does not replace

The plugin is an agent workflow layer.

It does not replace your normal project tools.

You still need whatever produces the underlying evidence, from tools such as:
 - Static analysis
 - Mutation testing
 - Your test suite
 - Compilation and type checking
 - Custom validation scripts


And your project still needs the Redproof library when it contains executable Gates.

The responsibilities stay separate:

| Component | Responsibility |
| --- | --- |
| Project tool | Produce evidence |
| Redproof library | Define and evaluate project contracts |
| Redproof plugin | Help the agent discover, build, challenge, and consume those contracts |
| CI | Run shared verification for the repository |

---

## Using the plugin during normal implementation

Once a project already has useful Gates, most agent tasks do not need `discover`, `design`, or `build`.

With plugin 0.2.0 or later in Claude Code, the normal loop is much simpler:

```text
agent reads task
        ↓
agent edits code
        ↓
runs focused development checks
        ↓
tries to finish
        ↓
Stop hook runs Redproof
        ↓
PASS → done
FAIL → repair
REFUSE → repair evidence
```

The agent can still run:

```bash
npx --no-install redproof check
```

manually whenever useful.

The hook makes the final check harder to forget. In Codex, run it manually.
Run `redproof prove` in CI and when you change a Gate or what its evidence
checks. For a focused proof run in a configured project:

```bash
npx --no-install redproof prove gates/architecture.ts
```

---

## Keep focused checks fast

Redproof should not replace the agent's normal development feedback loop.

While working, the agent may run:

```text
one test file
one package's type-check
one lint target
one focused repository script
```

That is usually the fastest way to iterate.

Then, before finishing:

```text
redproof check
```

verifies the important project contracts.

A useful split is:

```text
while editing:
  smallest useful native check

before finishing:
  relevant Redproof Gates

in CI:
  full shared verification
```

---

## Challenge newly written safeguards

Agent-written safeguards deserve the same skepticism as agent-written production code.

Suppose the agent says:

```text
I added a regression test for the bug.
```

A passing test only tells you:

> The current implementation satisfies the test.

A stronger question is:

> Would the test fail if the bug came back?

Use the published `challenge` skill for this.

For example:

```text
Challenge the regression test we just added.
Reintroduce the original defect temporarily,
run the safeguard, then restore the project.
```

The useful sequence is:

```text
healthy implementation
        ↓
safeguard passes

temporary regression
        ↓
same safeguard fails

restore
        ↓
safeguard passes
```

For contracts that deserve permanent protection, capture the same idea as a Redproof proof.

See [The Contract-to-Gate method](./contract-to-gate.md) for the detailed proof model.

---

## Review agent changes by their claims

The plugin's `review-pr` skill is useful because agent-generated changes often come with high-level claims:

```text
"The architecture boundary is now clean."

"The new check prevents the original regression."

"This refactor preserves every exported row."

"The release now includes every package."
```

Do not treat those statements as evidence.

Use them as questions.

For each important claim:

```text
claim
  ↓
what evidence would establish it?
  ↓
what counterexample would make it false?
  ↓
which Gate or native check can test it?
```

The plugin helps perform that investigation.

This complements ordinary code review rather than replacing it.

---

## A practical adoption path

You do not need to adopt the library, plugin, skills, and hook all at once.

### 1. Install the plugin

This gives the agent access to the published Redproof workflows.

No project changes are required yet.

### 2. Run `discover`

Ask the agent to identify a few important project promises worth protecting.

Do not try to model the entire repository.

### 3. Choose one Gate

Pick a contract where a missed regression would matter and where reliable evidence already exists.

### 4. Design it

Use `design` to define the Rule, evidence, and proof strategy.

### 5. Build and prove it

Approve the implementation and use `build`.

### 6. Use the hook during normal work

Once useful Gates exist and plugin 0.2.0 or later is installed, Claude Code
can automatically check relevant work before the agent finishes. Use a
manual project check in Codex.

### 7. Use `challenge` and `review-pr` when needed

Use them for new safeguards and higher-risk changes rather than every small edit.

---

## The whole system

The pieces fit together like this:

```text
                project tools
      Vitest / ESLint / scripts / etc.
                     ↓
               Redproof library
          Rules / Gates / Checks / Proofs
                     ↓
        ┌────────────┴────────────┐
        ↓                         ↓
      CI                    Redproof plugin
                              ↓
                    skills + Stop hook
                              ↓
                         coding agent
```

The plugin is not the enforcement engine.

The project is.

The plugin gives the agent a structured way to work with that enforcement.

---

## The main idea

The agent should not need perfect memory of every repository rule.

It should have both:

```text
instructions
```

for how the team wants it to work, and:

```text
executable project guardrails
```

for what must remain true.

The published Redproof plugin connects those guardrails to the agent workflow:

```text
discover important promises
        ↓
design Gates
        ↓
build and prove them
        ↓
challenge safeguards
        ↓
review claims
        ↓
check work before the agent finishes
(automatically with the Claude Code hook)
```

The result is a useful separation:

```text
the agent proposes changes

the project provides evidence

Redproof evaluates the contracts
```

---

## Next

- [Install the Redproof agent plugin](../agents/plugin/redproof/README.md) — installation and plugin reference.
- [Built-in Adapters](./built-in-adapters.md) — connect existing project tools to Redproof.
- [The Contract-to-Gate method](./contract-to-gate.md) — design and prove project Gates.
- [Redproof Proves Redproof](./red-proving-redproof.md) — see real guardrail patterns used in the Redproof repository.
