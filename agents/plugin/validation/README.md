# Release evidence

These reports record bounded checks against exact plugin bundles. They are
maintainer attestations, not agent diaries or guarantees about untested behavior.

| Tested bundle | Evidence | Scope |
| --- | --- | --- |
| 0.1.0, fingerprint `72cad10e…` | [2026-09-29 host checks](2026-09-29-0.1.0-host-checks.md) | Local installation and bounded behavior checks in Codex and Claude |
| 0.1.0 preview, fingerprint `e5184374…` | [2026-09-30 session-only loading](2026-09-30-session-loading.md) | Claude startup loading only; not release readiness |

Full fingerprints and limitations are in each report. These summaries preserve
previously recorded results; reorganizing them does not constitute a new test run
or certify the current source tree. See [the release procedure](../RELEASING.md).
