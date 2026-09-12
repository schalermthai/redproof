# Knip expert dogfood

The Knip adapter is checked against three kinds of evidence: Knip's own
self-check, its upstream regression fixtures, and native consumer configurations
in ESLint and Vitest. Redproof's own unused-code Gate provides a separate
shipping control.

## Reproduce

Use Node 24, install the Redproof workspace and run `npm run build`. Clone Knip
alongside Redproof, pin commit `23419b4edfd48796dd484fa880e1bad49a043d2e`
(Knip 6.35.1), install its locked pnpm dependencies, and compile its core before
checking production mode. The scripts accept explicit checkout paths:

```bash
node --experimental-strip-types scripts/dogfood-knip.ts ../11-knip
node --experimental-strip-types scripts/dogfood-knip-stretch.ts ../11-knip ../06-eslint ../05-vitest
```

These are explicit local expert experiments, outside normal CI. They run
mutations sequentially through `runProof` and restore them; the self-check
script also compares the original source, config and manifest after its run.
Use dedicated checkouts and do not edit the same files during a proof run.

## Baseline and proofs

Knip's source CLI scans its own repository. The first ordinary baseline
inspected 1,280 files with no selected issues. Five RED proofs add an unused
file, unused value export, unused type export, unresolved import, and unused
dev dependency. Invalid configuration REFUSES; unchanged code passes. Native
JSON is compared on every check, including the RED baselines: seven proofs
and thirteen independent native comparisons.

The stretch script compares category, file and position evidence from upstream
duplicate-export, catalog, catalog-reference and circular-import fixtures. It
also exercises production/strict scope, ESLint's root workspace and full scan,
and Vitest's configuration-hint policy. Existing native failures remain visible;
the script checks verdict/report agreement rather than relabeling every expert
checkout as a healthy baseline.

ESLint's checkout at `b684bb1cd7e6be03ad1b7a951baead936d9c2166` has a clean
root-workspace baseline of 844 files. Adding an unreachable source file breaches
the files Rule. The initial full scan fails to load documentation plugins absent
from that checkout: Knip emits findings but exits 2, so Redproof REFUSES.

The existing Vitest checkout contains a previous Redproof harness that its Knip
config does not declare as entrypoints. Native Knip reports those files and an
unused adapter dev dependency. This is a useful dirty-baseline parity control,
not evidence that Vitest upstream has those defects.

That checkout has Knip 6.33.0, whose reporter lacks configuration-load status.
The adapter explicitly REFUSES that unsupported version. For supported-version
parity, the stretch script temporarily installs a Node entrypoint under the
checkout's node_modules that loads the pinned Knip source CLI, then restores it.
This leaves Vitest's dependency manifests and native configuration intact.

## Findings retained in the adapter

- Standard Knip JSON omits inspected counts and enabled-category metadata.
  A custom reporter preserves both, preventing a disabled scan from looking
  like an empty success.
- `cycles` is disabled by default and uses warning severity when enabled.
  Four native warning cycles exit zero but breach four Redproof findings.
- Duplicate groups carry positions on their members. Diagnostics retain the
  first member's location and list all member positions in detail.
- Catalog findings need the namespace as well as the package name.
- Configuration failures can coexist with well-formed findings. Partial
  analysis REFUSES before those findings can become breaches.
- Blocking configuration/tag hints can explain a failing exit independently
  of issue findings. Their metadata is retained and causes REFUSE.
  Diagnostics include the offending hint identifiers; a native regression
  combines a stale ignored dependency with an unselected export finding.
- A mutation in Knip's own runtime dependency can prevent the producer from
  starting. Use an unexecuted import expression when proving unresolved-import
  analysis; keep producer startup failures as separate REFUSE controls.

Local regression tests cover warning/off/exclude selection, nested paths,
report isolation, invalid structures and counts, missing reports, timeout,
signal, output bounds and Gate-owned empty-evidence policy. These small tests
remain runnable without the large expert checkouts.

## Verification and remaining scope

The implementation run passed 706 repository tests, six Gates protecting 34
Rules, and all 46 repository proof outcomes. Clean-consumer verification packs
all seven packages and runs native Knip GREEN/RED checks using the shipped
reporter. These are recorded results, not a promise of coverage for every Knip
configuration or release.

The supported installed-version range starts at Knip 6.35.1 and excludes 7.
Further useful stretches are a fully provisioned ESLint documentation scan,
a clean Vitest checkout on a supported Knip version, and platform-specific
process/path behavior. The current dirty or incomplete consumer baselines are
explicit controls, not substitutes for those clean runs.
