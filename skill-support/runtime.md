# Using these skills from a plugin

The project being examined is not the installed plugin. Resolve instruction
links and helper scripts from the current skill's installed directory; keep
reports, experiments and implementation in the user's authorized work area.
Do not write into the plugin cache or expect Redproof's source tree to exist
inside the target project.

References such as `$design` identify this plugin's skills, not shell
commands. In Codex, select the skill belonging to Redproof, not another plugin's
similarly named skill. In Claude Code the
plugin namespace is `redproof`, for example `/redproof:design`.
For an authorized handoff, use the host's skill facility when available;
otherwise read [the bundled design skill](../skills/design/SKILL.md) and its required
references. A name alone does not start another agent or authorize a new stage.
If a sibling is missing, report the incomplete installation rather than invent
its instructions.

Only `discover`, `design`, `build`, `challenge` and `review-pr` are public skills.
Routing and the review UI are internal resources, not commands or hidden skill
registrations. Read [routing](routing.md) when stage selection is uncertain or
existing artifacts may let the user skip earlier stages. Discovery, design and
build link to the [review UI guide](review-ui/guide.md) when a report or scoped
decision is due. Keep its runtime next to its assets; do not ask the user to invoke
`start` or `review-ui`. Routing selects only work within the user's request.

Discovery and design can proceed without installing the Redproof library.
Implementation and certification use the target project's approved tools and
Redproof version. Inspect that version's API and docs; do not silently download
a different version. The plugin ships instructions and a dependency-free Node
review helper, not the npm library, adapters, or third-party guardrail tools.
Use Node 24 or later for the supported helper runtime. Missing tools are a
prerequisite to report, not a reason to claim certification.

Use only tools the host actually provides. Without a browser, provide the local
HTML and a short chat choice; without Node or permission to bind a local server,
use native questions or chat. Without authorized delegation, disclose the lack
of an independent review instead of claiming one happened. Preserve the calling
skill's approval boundaries in every fallback: no reply is not approval, a
preview is never authorization, and installation, enforcement, publication and
unrelated changes need their own authority.
