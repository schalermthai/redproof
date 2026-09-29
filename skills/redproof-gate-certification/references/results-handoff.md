# Certification results a newcomer can act on

Close the loop: what did we agree to protect, what was delivered, how do we know,
what did we learn, and what should happen next? Report results, not a work log.

## Design the reading experience first

Before filling the report, sketch the reading path around the owner's decision:
**What do I have now? What can I rely on? What should happen next?** Separate that
path from the audit record. A complete technical record pasted into an HTML
template is not a beginner-friendly handoff.

The first screen should communicate the overall result, the most consequential
limitation and a recommended next action. Follow with a compact overview of every
selected protection. Use practical names (for example, “Files stay inside their
allowed folder”), not internal Rule IDs as headings. Show mixed outcomes together;
do not make the reader finish one long success story to discover another blocker.

For each protection, write short plan-versus-delivery statements, what the checks
establish, the visible limit, an important learning/improvement, and the next
decision. Usually one sentence per point is enough. A concrete example should
explain the consequence, not introduce more jargon. Preserve meaningful scope
changes and blocking inputs in this reading path.
Place the Gate's recommendation and choices after its delivery, evidence and
material limits; learning and audit detail should not delay the decision. Translate
implementation lessons into consequences (for example, “Tests reused an old build”),
then preserve the exact mechanism in the technical record.

Use the shared helper's `certification.reader` fields for this concise layer.
Keep full proof inventories, file paths, revisions, digests, approval history and
technical describes in labelled disclosures. Never shorten original evidence or
describe blocks to manufacture a cleaner result; write separate summaries.
The user must not need to open a disclosure to discover that a Gate is incomplete,
fixture-only, not independently reviewed, or narrower than the approved promise.

Avoid turning statuses or proof counts into a score, certificate or general
security claim. Pair status colors with words; opening evidence starts no work.

For a substantial layout redesign, when independent UX/writing review is authorized,
brief the reviewer on the audience and decision before showing the old report.
Then reveal the content and review actual browser screenshots together. Record
what changed after that review; do not label a content-informed critique “blind.”

## Start with the outcome

Lead with a short mixed-status summary in everyday language. Keep implementation
status, technical trust and actual Check verdicts separate. A successful RED proof
means the deliberately broken project failed for the intended reason; it is not
an unresolved defect in the restored project. REFUSE proof success is likewise
different from a blocked real baseline. Explain this distinction when relevant.

State real versus fixture evidence and reviewer independence in the concise
summary. Keep exact target/version, restoration records and traceability in the
technical record.

## Compare approved design with actual delivery

Use the original selected design and authorization record as the comparison base,
not a newly rewritten description. Cite its path/review ID and version when known.
If unavailable, say so; do not reconstruct an allegedly approved design from code.

For each selected Gate, preserve a full comparison covering its material Rules,
Check/evidence source, scope/platform, proof plan and completion criteria:

| Promise or component | Approved design | Actual delivery and evidence | Disposition |
| --- | --- | --- | --- |
| Example: reference behavior | Run the selected native examples | Recorded native run and proof results | Delivered, changed, deferred or blocked |

Explain meaningful differences, their reasons and authorization. Separate harmless
engineering choices from changed promises requiring renewed design approval.
Unapproved narrowing cannot be presented as full delivery. Preserve original
Rule identities and explicitly map renamed/split Rules rather than hiding gaps.

Put **Selected design · describe** and **Delivered implementation · describe**
together in the clearly named technical disclosure, side by side on wide screens
and stacked on narrow screens.
They must be one obvious click away, not a compulsory wall of code before the
decision. Use actual Redproof syntax. Preserve the proposed block as proposed;
capture actual CLI output when already available
or use the real formatter on inspected implementation data, stating which method
was used. Description output is not proof execution. For an absent implementation
or unavailable output, show a clear absence note instead of fabricating a block.
A fixture prototype must not appear as the actual full Gate without qualification.
Label an incomplete delivery **Partial implementation · describe** and retain its
specific scope or prototype qualifier above the block. Place provenance below
the pair so the describes align. Wrap long lines visually without changing the
stored describe text; keep comparison words legible, using contained
scrolling or stacked fields on narrow screens rather than fragmenting words.

## Explain verification and learning

For each Rule, show which planned proofs were established, failed, changed or not
run, with intended versus observed verdict/reason and a reference to recorded
evidence. Summarize in the reading path; place detailed logs in supporting records.
Include restoration and final healthy-state verification or their explicit gap.

Separate these two sections:

- **What we learned:** observation → significance → evidence. Distinguish an
  original project defect, a weakness in our new Check/harness, an environment
  limitation and an untested hypothesis. Preserve failed attempts that led to a fix.
- **What we improved:** before → change → verification. Credit existing controls;
  do not attribute earlier fixes or unexecuted suggestions to this run. Say “none”
  honestly when no improvement was made. Do not invent lessons to fill a template.

One small example, diagram or snippet can explain a surprising mechanism. Use it
only when it helps. A concise before/after pair often suffices; a decorative chart
does not replace an explanation. Put the takeaway before expandable detail.

## Recommend and collect the next step

Close with **Do first (recommended)**, the expected benefit and finish line, any
blocking input, and optional later improvements. Sometimes keeping the existing
Gate with no further work is right. Do not manufacture more work after success.

Use the shared helper's `certification` stage. Per Gate, offer only useful actions:

- `investigate`: the named read-only question/blocker to resolve; no repair or
  adoption. If an input is needed, state it explicitly rather than pretending
  clicking a button supplies missing source or access.
- `revise`: return to Gate Design for a specified scope/contract change; design
  only, not immediate implementation of broader coverage.
- `implement`: finish or improve the specified settled contract and rerun its
  certification within the displayed work area. No silent scope expansion.
- `later` / `skip`: no further work now / do not pursue the proposed follow-up.
  Neither disables or deletes the existing Gate or changes the recorded verdict.

Recommendations are not preselected. Preserve notes and unanswered choices.
Confirmation authorizes only the described next work within existing permissions.
Do not ask again for identical work already authorized; only new optional work,
material scope changes or missing authority need a decision. A results page must
not interrupt unfinished authorized work merely to collect another approval.
No adoption, installation, commit/push, CI or publication authority is implied.

After real submission, record the immutable result review and choices; route to
the owning skill and continue only selected work. Never rewrite prior design,
proof results or trust decisions as though the user retroactively approved them.

## Artifacts and acceptance

Write `certification-summary.md`, the shared helper's `review.html` and the detailed
certification/evidence record in an authorized report directory (or task-owned
temporary directory). Markdown is the concise fallback with matching describes,
comparison and links to implementation/logs. Do not regenerate product evidence
just for presentation. On a narrow follow-up, update existing report artifacts,
but never overwrite an answered review: create a new review ID/directory.

Use the shared helper for escaping, offline readability, local collection and
expiry handling. If it is unavailable, produce a static HTML report and short
chat choices, not a new collector. Explicit no-file/alternate-format requests
override artifact defaults while retaining outcome/uncertainty honesty.

Before delivery, verify:

- Every selected Gate appears, including failed, partial, blocked or rejected work.
- Original design, implementation, recorded evidence and comparison agree;
  scope drift and missing describes are explicit, not silently normalized.
- The main path explains results, insights, actual improvements and next steps.
- Perform a closed-disclosure reading test: can a newcomer identify what was
  delivered, what remains unverified, and the recommended next action without
  reading code, opening evidence or interpreting PASS/FAIL/REFUSE terminology?
- HTML, Markdown and final chat agree on status and recommendations. Evidence
  links resolve where provided; do not present inert paths as clickable links.
  When a browser is available, inspect wide/narrow screenshots, not just DOM
  overflow tests; report unavailable views as a validation limit.
  Check first-screen hierarchy, reading length, real text wrapping, legible status,
  expanded describes, navigation and choices. Repair observed usability problems.
- Preview tests preserve follow-up choice, notes, cancellation and unanswered
  Gates without changing recorded results. No automated real approval is sent.

Deliver a short self-contained final response: what is verified, what remains,
one important learning, the recommended next action and the HTML reading link.
Report visual/testing limitations honestly. A polished HTML file is not evidence
that the Gate ran or that the updated skill behaved better in a fresh-agent trial.
