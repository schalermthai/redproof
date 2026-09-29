# Releasing the Redproof plugin

The plugin has its own release cycle. Publishing skills never publishes the npm
library, upgrades a consumer's library, or submits to a host's public directory.

## Three identities, one version

| Identity | Purpose | Example |
| --- | --- | --- |
| Plugin manifest version | The installed skills and shared UI | `0.1.0` |
| Source tag | Reviewed source used by the release workflow | `plugin-v0.1.0` |
| Generated snapshot tag | Complete installable marketplace and plugin | `plugin-bundle-v0.1.0` |

`plugin-marketplace` is the generated distribution branch. It advances to each
new release; the snapshot tags never move. There is no separate plugin repository
or npm package. Users can track that branch or pin an exact distribution tag.
Do not point users at the source metadata directory: it is not a complete bundle.

The source [manifest](redproof/.codex-plugin/plugin.json) owns the version. The
builder derives all host manifests; do not version each skill separately or use
the workspace's npm `set-version` command for the plugin.

## Version policy

- Patch: compatible fixes to instructions, resource paths or review UI.
- Minor: new capabilities or workflow options. Before 1.0, breaking changes also
  use a minor bump and must be clearly called out in the release notes.
- 1.0: a public workflow we are prepared to support.
- After 1.0, major: renamed/removed commands, incompatible handoff formats,
  changed approval semantics, or raised requirements that break supported usage.

Instruction edits are behavioral changes. Re-run the affected evaluations even
when the edit is short. Record the tested Redproof library and host versions;
being able to parse a manifest does not establish workflow compatibility.

## 1. Build and evaluate a local candidate

Change the manifest version, add an entry to [CHANGELOG.md](CHANGELOG.md), and
reset the host checks in [release-readiness.json](release-readiness.json) to
`pending`. Keep the release notes factual: list verified capabilities and limits.

From the repository root:

```sh
npm run test:plugin
npm run typecheck
npm run docs:typecheck
npm run self:check
```

Build a new preview directory (Node 24 and Git; no library build needed for this
builder). This preview may include uncommitted changes; it is not a source-tag
attestation. The production workflow always checks out the exact source tag.

```sh
plugin_preview=$(mktemp -d)
npm run plugin:release:build -- \
  --tag plugin-v0.1.0 \
  --source-commit "$(git rev-parse HEAD)" \
  --out "$plugin_preview/marketplace"
```

The output contains both host catalogs, `plugins/redproof`, release notes and
`release.json`. The latter reports the `bundleSha256` fingerprint of the complete
plugin inventory. There are no dependencies, expert fixtures or planning logs.

## 2. Test the installed plugin, not only its source

Validate the plugin and marketplace with available host validators. Register the
preview directory as a local marketplace, install the plugin, and start a fresh
session. Installing changes the chosen host profile: use an explicit test profile
or a deliberate user/project scope, not a teammate's existing configuration.

For Codex, register the preview with `codex plugin marketplace add` and install
Redproof from the plugin UI. For Claude, register with `claude plugin marketplace
add`, then install `redproof@redproof-plugins` with your intended scope. See the
[consumer guide](MARKETPLACE.md) and the host documentation linked there.

Record each check separately for **both** hosts:

| Check | What constitutes a pass |
| --- | --- |
| installation | The marketplace-installed copy resolves all bundled resources. |
| publicSkills | Exactly discover, design, build, challenge and review-pr; no start/review-ui commands. |
| approvedHandoff | Discovery can hand off an explicit user selection to design and approved build. |
| reviewUI | An installed helper opens a synthetic review and returns the selected response. |
| authorizationBoundaries | Preview, timeout and silence authorize nothing; recheck-only does not repair code; missing-tool fallback is honest. |

Record host versions, scenario, result and limitations in [VALIDATION.md](VALIDATION.md).
Set only observed passes in `release-readiness.json`; copy the exact bundle hash
into that record. Do not infer behavioral passes from packaging tests or from an
agent claiming it would follow the instructions. Rebuild after edits: any change
to bundled bytes invalidates the recorded hash. Readiness records are human
attestations, not signatures or host marketplace approval.

```sh
node scripts/publish-plugin.ts --verify "$plugin_preview/marketplace"
```

This command intentionally fails until the preview includes the completed
readiness record. Rebuild to a fresh directory after recording evidence. The
readiness file itself is not part of the plugin inventory, so recording results
does not invalidate the bundle fingerprint.

## 3. Review, tag, and dry-run

Commit and review the changes normally. Merge the workflow onto the default branch
before dispatching it. From the reviewed release commit, create and push the
source tag; do not move a published tag:

```sh
git tag -a plugin-v0.1.0 -m "Redproof plugin 0.1.0"
git push origin plugin-v0.1.0
gh workflow run publish-plugin.yml --ref main -f tag=plugin-v0.1.0 -F dry-run=true
```

Tag push alone does not publish. A dry run builds the exact tagged source, runs
the standalone tests and uploads a preview artifact. It does not update the
marketplace, require host passes, create a release or publish npm packages.

Inspect the artifact before proceeding. It includes hidden host catalog folders
and a deterministic archive with a checksum. CI does not install host CLIs or run
paid agent sessions: the recorded host evaluations are a separate release step.

## 4. Publish early access

Create a GitHub release for the existing source tag, mark early 0.x releases as
prereleases and select **not the latest release** so they cannot displace the npm
library's latest release. Use the plugin changelog as release notes. Publishing
that GitHub release triggers the plugin workflow; the npm workflow skips it.

The publish job:

1. Requires every host check and an exact-bundle fingerprint match.
2. Publishes the distribution branch and immutable snapshot tag in one atomic
   Git push. It never force-pushes or edits the main branch.
3. Attaches the archive and checksum without replacing existing assets.

An intentional manual dispatch with `dry-run=false` publishes the marketplace
but does not create a GitHub release or attach assets. Prefer the GitHub-release
path for the public release record. Only maintainers should have permission to
publish releases or run write-enabled workflows. If branch/tag rules deny the
automation, configure narrowly scoped permission for this release workflow;
do not weaken main-branch protections. Public-directory submission is separate.

## Failure, retries and rollback

- Missing host evidence: no marketplace write. Complete the checks before making
  the final source tag. If you already released an unready tag, do not move it;
  make a corrected release under a new version.
- Failed Git push: the branch and tag stay unchanged together. Retry after the
  underlying permission/network issue is resolved.
- Retry after successful publication: identical bytes are a no-op. Different
  bytes under the same version are refused. An older retry cannot move the
  marketplace back from a newer release.
- Failed release-asset upload: rerun the workflow; existing assets are retained.
- Bad release: publish a higher patch version restoring the known-good behavior,
  or direct users to the prior immutable distribution tag and reinstall. Never
  silently replace a released version. Users following a pinned tag stay pinned.

The publisher's local Git tests cover first publication, monotonic versions,
immutable retries and atomic failure. They do not establish GitHub permissions,
remote marketplace refresh, installed model behavior or directory approval.
