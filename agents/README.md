# Agent tooling

Everything used to build and ship the Redproof agent plugin lives here:

| Folder | Purpose |
| --- | --- |
| [skills/](skills/discover/SKILL.md) | The five public skills |
| [skill-support/](skill-support/runtime.md) | Shared routing, host guidance and review UI |
| [plugin/](plugin/redproof/README.md) | Plugin metadata, installation and release documentation |
| [scripts/](scripts/build-plugin.ts) | Bundle builder, release builder and publisher |
| [tests/](tests/plugin.test.ts) | Packaging and release-safety tests |

Run `npm run test:plugin` or `npm run plugin:build` from the repository root.
See [the release guide](plugin/RELEASING.md) for the full workflow.

`plugin/files.json` lists paths relative to this directory. The builder puts
`skills/` and `skill-support/` directly in the installed bundle; it does not ship
an `agents/` wrapper. Public skill names and installation commands are unchanged.

GitHub workflows and `.claude/settings.json` stay at the repository root because
their hosts discover them there. General library scripts, Gates and tests remain
outside this directory.

Commit maintained tooling, documentation, tests and concise release evidence—not
agent transcripts, session IDs, progress diaries or temporary evaluation output.
Keep local working notes in the ignored `.planning/` directory.
