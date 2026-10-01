# Redproof skills plugin

Help your coding agent find important project promises, build guardrails, and
prove those guardrails catch regressions.

## Install

Run these commands in your terminal.

**Codex**

```sh
codex plugin marketplace add schalermthai/redproof --ref plugin-marketplace
codex plugin add redproof@redproof-plugins
```

If your Codex version does not offer `plugin add`, install Redproof from the
plugin browser after adding the marketplace.

**Claude Code**

```sh
claude plugin marketplace add 'schalermthai/redproof#plugin-marketplace'
claude plugin install redproof@redproof-plugins --scope user
```

This installs for your user account. Use `--scope local` instead for only you in
the current project.

The plugin installs skills and one [Stop hook](#the-stop-hook-claude-code),
**not** the Redproof npm library or project tools.
For version pinning and updates, see the
[installation guide](https://github.com/schalermthai/redproof/blob/main/agents/plugin/MARKETPLACE.md).

## Start here

Start a new session in your project. Select Redproof's **discover** skill in
Codex, or use `/redproof:discover` in Claude Code, then ask:

> Find the important promises this project makes. Show where our existing
> checks might miss a regression, and let me choose what to protect first.

You get recommendations and draft Gate descriptions in a local HTML report,
with chat choices as a fallback.

```text
Discover → choose Gates → Design → approve implementation → Build and prove
```

Choosing a Gate approves design, not implementation. After you approve a build,
the agent implements it, runs proofs, restores temporary faults, and reports
results or blockers. CI changes and publication need separate approval.

## Choose a skill

You can start at any stage your existing decisions support.

| Skill | Example request |
| --- | --- |
| `discover` | “Which important project promises need stronger protection?” |
| `design` | “Design a Gate for cross-workspace invoice privacy.” |
| `build` | “Implement the approved Gate and prove it catches the regression.” |
| `challenge` | “Does our architecture check catch a forbidden import? Test it once and restore it.” |
| `review-pr` | “Does this PR actually deliver its claim that exports preserve every row?” |

For assessment only, ask **build**: “Recheck this Gate; report gaps without
repairing it.” In Claude Code, use the `/redproof:` prefix for each skill.

The interactive report helper needs Node.js 24+ and a local browser. Without
them, use chat. Building Gates also requires your project's approved Redproof
library and checking tools; a passing proof covers its tested scope, not every
possible defect.

## The Stop hook (Claude Code)

A hook is a command the host runs at a fixed point in its work. This one runs
when the agent ends a turn. It runs your project's own `redproof check`. When a
Gate fails, the turn stays open and the agent receives the report.

- **Quiet elsewhere.** In a project with no `redproof.config.*` file, the hook
  does nothing and prints nothing.
- **Changed work only.** The hook looks at the files changed since the session
  started, committed or not. The nearest config above a file owns that file.
  Only owning configs run, so a session started in a subfolder still works, and
  a turn that changed nothing costs no check.
- **Your install only.** The hook runs the Redproof library in your project's
  `node_modules`. It never downloads or installs anything.
- **Fixes are checked again.** After 3 failed checks in one turn, the turn ends
  with a warning that the Gates still fail.
- **No silent pass.** When the Redproof library is not installed in the
  project, the hook warns you that the Gates are unverified, shows the install
  command, and lets the turn end. It does not ask the agent to install anything.
  The warning appears once per session. When the library is
  installed but the check crashes or times out, the hook blocks once per
  session, then warns.

The hook needs git and the Node.js version your Redproof library needs.

To turn the hook off for one shell, set `REDPROOF_STOP_HOOK=off`. To turn it off
for one project, add `redproof.stop-hook.json` at the repository root:

```json
{ "enabled": false }
```

The same file can skip configs that are test data, not real projects:

```json
{ "ignore": ["fixtures/**"] }
```

If your project already runs `redproof check` from a Stop hook in
`.claude/settings.json`, both hooks run. Keep one.

Codex does not load hooks from this plugin yet. The skills work in both hosts.

See [Guardrails for agent-written code](https://github.com/schalermthai/redproof/blob/main/docs/agent-guardrails.md)
for worked examples.

## For maintainers

[Build, test and release](https://github.com/schalermthai/redproof/blob/main/agents/plugin/RELEASING.md)
· [Release evidence and limits](https://github.com/schalermthai/redproof/blob/main/agents/plugin/validation/README.md)

Plugin releases are versioned separately from the npm library.
