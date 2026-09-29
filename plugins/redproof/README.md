# Redproof skills plugin

Find the promises a project should protect, turn selected promises into Gates,
and prove those Gates catch the regressions you fear.

```text
Discover opportunities → choose with the user → design a Gate
                       → approve a scope → implement and certify → review results
```

This bundle contains five public skills and shared internal resources, not the
Redproof npm library. Installing the
plugin does not install dependencies, create Gates, enable CI, or grant approval
for mutations. There are no automatic hooks, MCP servers, or network services.
The review helper starts a loopback server only when explicitly run for a handoff.

## Start here

Ask: “Use Redproof discovery to find the important promises in this project.
Propose Gates and let me choose before implementation.”

| Skill | Use it for |
| --- | --- |
| `discover` | Researching project claims and proposing useful Gates |
| `design` | Designing the selected Rules, evidence and proof cases |
| `build` | Building an agreed Gate and proving it, or rechecking an existing Gate |
| `challenge` | Testing whether one safeguard detects a bounded deliberate fault |
| `review-pr` | Challenging a pull request's important claims |

In Codex, select Redproof's `discover` skill (referenced as `$discover` in these
instructions). In Claude Code, use
`/redproof:discover`. Keep the namespace when invoking other plugin
skills in Claude Code. Natural-language requests also work when the host makes
the skills available. The agent must resolve installed skills, not treat these
names as terminal commands.

Start with **discover → design → build**, or enter at the stage your existing
decisions support. Routing is shared guidance, not a `start` command. The
interactive report appears as part of those workflows; `review-ui` is not a
public skill. Both helpers live in `skill-support/`, outside the discoverable
`skills/` directory, without a `SKILL.md` registration or host-specific hide flag.

For example, ask `build` to “Recheck this existing Gate; do not repair it” when
you want an assessment only. The agent must restore temporary proof mutations
and report gaps without treating the request as authority for permanent changes.
`challenge` is a smaller, one-off investigation; it is not the npm library's
`redproof prove` command, which runs a Gate's recorded proof portfolio.

## Local use and prerequisites

Use Node 24+ for the bundled review helper and its tests. Discovery/design do
not require the Redproof library. Implementing and certifying a Gate requires
the target project's approved Redproof version and evidence-producing tools;
check their APIs and availability first. No dependencies are bundled or fetched.
Without Node, browser access, or permission to run a local server, the skills
fall back to native questions or a short chat handoff without inventing approval.

Claude Code supports loading a local bundle for a session without marketplace
publication. From the project you want to examine:

```sh
claude plugin validate /absolute/path/to/redproof --strict
claude --plugin-dir /absolute/path/to/redproof
```

For Codex, this bundle provides a portable root manifest and a compatibility
manifest at `.codex-plugin/plugin.json`. Use your host's approved local-plugin or
marketplace installation flow. This release does not register a marketplace,
alter your settings, or promise that a remote listing already exists. Do not
point an installer at the source metadata directory: build the bundle first.

### Installation scope is chosen by the host

Claude's interactive installer offers user-wide, shared-project and local-only
scope. Its shell installer defaults to user-wide unless `--scope project` or
`--scope local` is specified. Loading with `--plugin-dir` is a one-session test,
not a persistent installation. See [Claude installation scopes](https://code.claude.com/docs/en/discover-plugins#choose-an-install-scope).

Codex's local-plugin browser records user-level choices; trusted project config
can enable or disable local-marketplace plugins for that repository. Do not
assume it has the same scope picker as Claude. See [Codex project settings](https://developers.openai.com/plugins/build/plugins#enable-or-disable-a-plugin-for-a-repo).
Redproof does not add its own installer or change either host's settings.
Installation scope controls availability, not permission to modify a project.

## What has been verified

The packaging tests verify identical source/bundle skill content, relative
resources, matching host metadata, reproducible file hashes, and the review
helper running from a temporary bundle with an unrelated working directory.
They also test missing resources, symlinks, unexpected files and overwrite refusal.
The helper's synthetic review tests do not certify any real project.

Manifest validation is not end-to-end host compatibility. Before claiming an
installed release works on a host, check skill discovery, namespaced invocation,
an authorized stage handoff, preview review submission, missing-tool fallback,
and refusal to treat silence as approval in a fresh session on that host.
Keep that validation record with the release; do not infer it from a green build.

## Building and releasing (maintainers)

In the Redproof repository, run `npm run plugin:build`. No npm install or library
build is needed for this command when Node 24+ is available. It prints a fresh
temporary `redproof` directory. For a retained bundle, pass
`-- --out /existing-parent/redproof`. The destination must not exist; the builder
never deletes or overwrites an earlier bundle. Failed writes may leave a partial
directory: do not distribute it; choose a fresh destination after fixing the error.

Edit public skills in the repository's canonical `skills/` directory and shared
helpers in `skill-support/`; do not edit generated bundle copies. Update
`plugin/files.json` when adding a required resource. The small synthetic helper
fixture and its self-tests are intentionally included; experimental project
fixtures, reports, planning records, dependencies and library code are not.
`bundle-files.json` records deterministic content hashes, not a security signature.

The source `.codex-plugin/plugin.json` owns plugin identity/version. The builder
derives the portable and Claude manifests from it. Plugin version `0.1.0` is
independent of npm releases. These instructions were packaged against Redproof
`0.12.0` documentation; that is a reference version, not certification against
every library/adapter/host combination. Verify the target version before using it.

Before publishing: run `npm run test:plugin`, both host validators where available,
and the fresh-session checks above; record supported versions and limitations,
then prepare the chosen marketplace's listing and installation test separately.
No marketplace publication is part of the build.

Format references: [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins)
and [Claude Code plugin reference](https://code.claude.com/docs/en/plugins-reference).
