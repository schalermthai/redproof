# Local review contract

Write plain text JSON with `version: 1`, a new stable `reviewId`, `stage`
(`discovery`, `design` or `certification`), `preview` (boolean), `title`, `background`,
`recommendation`, `evidenceStatus`, `workArea`, `boundaries`, and `gates`.
Use project-specific language, not a governance questionnaire. This page should
make sense to a teammate who did not read the conversation.

Each Gate has `id`, `title`, `summary`, `example`, `evidence`, `describe`, and
`actions`. Optional `details` contains supporting text, not executable HTML.
Each action has `id`, `label`, `description`, and optional `recommended: true`.
Its description states the effects and stopping point. Permitted IDs:

| Stage | IDs | Meaning |
| --- | --- | --- |
| Discovery | `design`, `later`, `skip` | Select for detailed design only; leave for later; do not pursue |
| Design | `revise`, `experiment`, `implement`, `later`, `skip` | Design only; disposable experiment; local implementation and proof; later; skip |
| Certification | `investigate`, `revise`, `implement`, `later`, `skip` | Named read-only investigation; design revision; scoped implementation/proof; later; skip follow-up |

## Certification results

Certification Gates have no scope picker: each offered next action describes its
bounded scope, effects and stopping point. Responses use `scope: null`. A broader
promise goes through `revise` first, not a generic “strengthen” implementation.
Later/Skip mean no further work, never disable/delete the existing Gate.

Each Gate additionally requires a `certification` object:

- `status`: `implemented-and-verified`, `partially-implemented`, or `blocked`.
- `decision`: `trusted` or `not-trusted`, always bounded by the recorded contract.
  Only implemented-and-verified can be trusted; verified requires trusted.
- `designReference`: original design/review/version, or explicit missing-reference note.
- `designDescribe`: original proposed describe string, or `null` if unavailable.
- `actualDescribeSource`: captured CLI/formatter source and version, or why absent.
- `comparison`: nonempty rows `{ promise, planned, actual, disposition }`, where
  disposition is `delivered`, `changed`, `deferred`, or `blocked`. Include evidence
  references and change authority in the text, not invented approval.
- `verification`: per-Rule/proof results, actual target, evidence references,
  restoration, limitations and reviewer independence (multiline plain text).
- `insights`, `improvements`, `nextStep`: plain-language learning, verified changes
  and ordered recommendation with prerequisites; honest absence is valid.

In this stage only, Gate `describe` is the actual implemented describe or `null`.
Verified status requires it; other statuses may show a partial implementation's
describe with explicit limits in `actualDescribeSource`. A null design block
is labelled unavailable, never manufactured. The helper checks schema/status
consistency, not whether claims are true; the caller must reconcile source evidence.
These fields are immutable result data, not editable verdicts in the response.

### Reader-facing summaries

New certification reports also supply `certification.reader`, an object with
`planned`, `delivered`, `evidence`, `limitation`, `change`, `insight`, `improvement`,
and `nextStep`. Each is a concise plain-text explanation, usually one sentence.
The runtime accepts older snapshots without this object, but new handoffs should
not rely on that compatibility fallback. It retains full technical fields rather
than truncating them automatically.

Use `planned`/`delivered` for a short before-and-after pair, `evidence` for what
the checks establish, `limitation` for what cannot yet be relied on, and `change`
for a material difference from the approved plan (or explicitly none). `insight`
and `improvement` explain what was learned and changed; credit earlier work when
reporting existing results. `nextStep` is the recommended action and required input.
Keep missing tools, fixture-only evidence, scope limits and review independence
visible; never bury a disqualifying caveat solely in the full evidence record.

Write title/background/recommendation/evidenceStatus for the first-screen reading
path. Avoid repeating preview warnings already supplied by the renderer. Use
Gate title/summary for practical protection and outcome, not an internal ID or
proof inventory. Actions retain precise effects and stopping points; do not trade
away informed confirmation for a short button label. Long paths, digests and raw
technical terms belong in the technical record. The renderer provides visible
status labels, a compact overview and disclosures for full comparison/describes.

## Design choices

Do not add adoption or publishing to this menu. Selecting `implement` requires
an agreed contract and known writable target; unresolved policy or evidence
boundaries make it unavailable. Local implementation is not adoption.
Recommend `implement` for a settled contract: its displayed finish line is a
Gate, Check and proofs run against the selected real project/tool, followed by
verified results or an explicit partial/blocked report. The writable target may
be a disposable copy. Known missing tools/dependencies are prerequisites, not
automatically evidence-boundary disputes. State required permission separately;
the selection itself does not grant installs or network access.
Selecting `experiment` requires a named uncertainty, bounded experiment plan,
learning-based stopping point and safe-copy location. Label it **Run a feasibility
experiment first**, not **Try in a safe copy**; state that it does not complete
implementation. Technical preflight still runs before any target code. No upstream
maintainer identity is required merely to design or learn in a disposable copy. The task
owner can own that experiment; production policy needs appropriate ownership.

Design Gates additionally have `scopes`, each with `id`, `label`, `description`,
`describe`, `actions` (allowed work-action IDs for this scope) and optional
`recommended: true`. Present concrete coverage, such as “headers and trailers on
HTTP/HTTPS” versus “also verify real socket behavior”, not Low/Medium/High quality.
Every scope must show what it includes/excludes, added work and what passing
would mean. Broader coverage may be design-only until investigated. If only one
honest scope exists, offer that one rather than inventing a larger option.
`later`/`skip` need no scope. Other design actions require explicit scope selection.
A scope chosen without a work action is retained as a preference, not authority
to start. The same applies to a retained scope beside Later or Skip.

Example **preview** input, abbreviated to one Gate (the content is illustrative,
not a policy or a claim of executed protection). This example is design-only
because its evidence mechanism is unsettled, not because dependencies are absent:

```json
{
  "version": 1,
  "reviewId": "storage-design-round-1",
  "stage": "design",
  "preview": true,
  "title": "How far should we take storage protection?",
  "background": "This service writes uploaded files. We want failed writes to leave existing files intact.",
  "recommendation": "Start with the file-replacement path in a disposable copy.",
  "evidenceStatus": "Source inspected. No tests or proofs run.",
  "workArea": "Disposable copies under the agreed temporary directory; original checkout is read-only.",
  "boundaries": "No installs, CI changes, publication or production adoption.",
  "gates": [{
    "id": "safe-replacement",
    "title": "Keep the previous file when a replacement fails",
    "summary": "A failed upload should not destroy a customer's existing file.",
    "example": "If writing the replacement fails halfway through, the original remains readable.",
    "evidence": "Existing tests cover successful writes; interruption behavior remains untested.",
    "describe": "Gate: safe-replacement\n\nRules:\n  R1 A failed replacement preserves the previous file.\n\nCheck:\n  Evidence mechanism remains proposed; investigate the existing file-write tests.",
    "actions": [
      {"id":"revise","label":"Refine the design","description":"Clarify the failure cases and evidence. No target code edits or execution.","recommended":true},
      {"id":"later","label":"Later","description":"Keep the idea; do no further work now."},
      {"id":"skip","label":"Skip","description":"Do not pursue this proposal."}
    ],
    "scopes": [{
      "id":"replacement","label":"File replacement only",
      "description":"Cover the existing local replacement path, not all storage or crash recovery.",
      "describe":"Gate: safe-replacement\n\nRules:\n  R1 A failed replacement preserves the previous file.\n\nCheck:\n  Evidence mechanism remains proposed; investigate the existing file-write tests.",
      "actions":["revise"],"recommended":true
    }]
  }]
}
```

Use real verified describes for actual handoffs. On selecting a scope the visible
describe changes to that scope's draft; no choice silently retains a broader
claim. Markdown retains all offered variants and their evidence limits.

For an implementation-ready scope, include `implement` in its allowed actions
and normally recommend this action instead of the design-only example above:

```json
{
  "id": "implement",
  "label": "Implement and prove this Gate",
  "description": "Build the agreed Gate, Check and proofs in the displayed safe copy. Run the selected real project/tool and review the proof results. Return verified results or a clear partial/blocked report. No installs, CI, commits or publication without separate authorization.",
  "recommended": true
}
```

Never change an already submitted experiment into implementation by relabelling
its snapshot. A new finish line needs new authorization.

The helper writes a standalone `review.html`, immutable `review.snapshot.json`,
and, after a real browser submission, `review.answers.json`. The response
contains `version`, `reviewId`, `reviewDigest`, `status`, `decisions`, and
`receivedAt`. Each decision carries `gateId`, `action` (or null), `scope` (or
null), and `note`. IDs must belong to the exact served snapshot. Cancellation
has no decisions. An unanswered entry remains null, including when it has a note.

The runtime serves only its rendered page, requires its session token and same
origin for JSON submission, rejects unknown/duplicate choices, bounds requests,
and accepts a response once. It does not run tools, execute code, grant system
permissions, or verify organizational authority. The caller must interpret the
structured decision in context, update its record and follow the right skill.

For tests and UI demonstrations, set `preview: true` prominently. Never use a
scripted acceptance of a preview as the user's authorization for real work.
