# Redproof plugin marketplace

Discover important promises, design Gates, then build and prove approved work.
Public skills: **discover · design · build · challenge · review-pr**.

This is the generated distribution tree, not the development branch. Both host
catalogs and the complete plugin are released together. `release.json` identifies
the source commit, plugin version and immutable `plugin-bundle-vVERSION` snapshot.
The readiness record describes the exact bundle tested; it is a maintainer
attestation, not marketplace approval or a signature.

## Install

For Codex, register the Git marketplace and install Redproof:

```sh
codex plugin marketplace add schalermthai/redproof --ref plugin-marketplace
codex plugin add redproof@redproof-plugins
```

If your Codex version does not offer `plugin add`, install Redproof from the
plugin browser after adding the marketplace.

For Claude Code:

```sh
claude plugin marketplace add 'schalermthai/redproof#plugin-marketplace'
claude plugin install redproof@redproof-plugins
```

The Claude install above defaults to user scope. Use `--scope project` to share
the configuration with teammates, or `--scope local` for only you in that project.
Start with `/redproof:discover`. In Codex, select the Redproof **discover** skill.

Need a fixed version? Replace `plugin-marketplace` in either add command with
the exact `plugin-bundle-vVERSION` tag from the release. Do not use the source
`plugin-vVERSION` tag: it does not contain this generated marketplace tree.

## Requirements and updates

The interactive review helper requires Node.js 24 or newer and a local browser.
Individual Checks need the project's approved Redproof library and evidence
tools. Installing this plugin does not install those tools or approve changes.

Updates are deliberate: refresh the marketplace and use your host's plugin
update/reinstall flow, then start a fresh session. Do not assume a branch push
reloads an active session or changes every installed copy. Users can pin the
marketplace to an older distribution tag to select a known-good snapshot; follow
the host's reinstall flow to replace a newer cached copy.

In the distribution tree, see `plugins/redproof/README.md` for the workflow,
`CHANGELOG.md` for release notes, `release.json` for identity and
`release-readiness.json` for host readiness.

Host instructions: [Codex packaging](https://developers.openai.com/plugins/build/plugins)
and [Claude marketplace maintenance](https://code.claude.com/docs/en/plugins/host-marketplace).
