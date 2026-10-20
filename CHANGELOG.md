# Redproof plugin releases

Independent of the Redproof npm library. Release versions are immutable.

## 0.3.0

- Discover writes every answer for a reader new to Redproof, in chat as well as
  in files. It opens with the decision, defines Redproof terms once, and keeps
  internal status labels out of the prose.
- Every discovery request except a time-boxed one produces a Markdown summary
  and an HTML report. The chat message summarises the handoff; it no longer
  replaces it.
- The review page from the bundled helper is the only HTML report. Discover no
  longer writes its own HTML page.
- Discover ranks recommendations by the uncovered gap. A promise that existing
  tests already guard stays visible as existing protection and is offered at most
  as a one-time proof. A top recommendation names the case no test exercises.
  Finding no uncovered case is a valid result.
- design, build, challenge, review-pr, the review UI and the Stop hook are
  unchanged from 0.2.0.

Measured on a headless discover eval with Claude Sonnet 5.5 and Claude Opus 5.5
against pinned open-source repositories (ky, Express, Click, chi), with Express
and chi held out of every skill edit. Limitations: about one Sonnet
recommendation in eight still claims a case is untested when a test covers it.
Opus 5.5 was checked only on Express for the ranking change.

## 0.2.0

- Claude Code Stop hook: runs the project's own `redproof check` when the agent
  ends a turn and keeps the turn open while a Gate fails.
- The hook stays silent in projects without a Redproof config, checks only the
  configs that own changed files, and reports a check that could not run.
- REFUSE reports remain unverified regardless of the configured CLI exit code.
- A silent, bounded session-start check records pre-existing located Breaches;
  unchanged ones warn without blocking unrelated work. New or touched Breaches
  still block, and fixed failures lose their exemptions.
- The five public skills and the review UI are unchanged from 0.1.0.

Limitations: Codex does not load hooks from this plugin. The hook needs git and
Node.js on the session's `PATH`; without Node the host reports a hook error and
nothing is checked. The hook was developed against Redproof 0.12.0 and runs the
library installed in the project; it does not install or upgrade one.

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
