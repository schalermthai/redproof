# Redproof plugin releases

Independent of the Redproof npm library. Release versions are immutable.

## Unreleased

- Claude Code Stop hook: runs the project's own `redproof check` when the agent
  ends a turn and keeps the turn open while a Gate fails.
- The hook stays silent in projects without a Redproof config, checks only the
  configs that own changed files, and reports a check that could not run.

- REFUSE reports remain unverified regardless of the configured CLI exit code.
- A silent, bounded session-start check records pre-existing located Breaches;
  unchanged ones warn without blocking unrelated work. New or touched Breaches
  still block, and fixed failures lose their exemptions.

Limitations: Codex does not load hooks from this plugin. The hook needs git.

## 0.1.0

Initial early-access package. The GitHub release records publication status.

- Five public skills: discover, design, build, challenge, review-pr.
- Shared routing and review UI remain internal resources.
- Discovery, design and build retain explicit human approval boundaries.
- One canonical skill source, portable/Codex/Claude manifests and standalone UI.
- Git-backed marketplace distribution with versioned snapshots.

Limitations: see the release readiness record before claiming host compatibility.
The instructions were developed against Redproof 0.12.0; that is not a promise
of compatibility with all library, adapter, model or host versions. Installation
does not install or upgrade the Redproof npm library.
