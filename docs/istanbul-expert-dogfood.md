# Istanbul coverage expert dogfood

The adapter is exercised against the coverage experts themselves, then used to
protect Redproof's own coverage model. Native reports are controls, not reports
fabricated to satisfy an adapter test.

## Pinned baselines

| Project | Commit | Native workflow | Observed baseline |
|---|---|---|---|
| Istanbul core, `istanbul-lib-coverage` 3.2.2 | `28ffdbc314596bdcb3007e85d30a62372602b262` | `nyc mocha` | 41 passing tests; six files; all four coverage metrics 100% |
| nyc 18.0.0 source | `908620475199fa7b9ea0ea8b21d6d8ad6921e3ae` | lint, clean, self-instrument, TAP tests, self-coverage report | Native command succeeds; 17 files; all four metrics 100% |

The expert checkouts have no dependency lockfiles for these installs. Source is
pinned, but dependency resolution is not fully reproducible. Install logs include
deprecation and audit warnings; this experiment did not upgrade their dependencies.
The local adapter suite pins nyc 17.1.0 and Istanbul's coverage library 3.2.2.

## Reproduce

Use Node 24 and dedicated expert checkouts. Install Redproof's workspace and
build it before running scripts. In the core checkout, install dependencies
inside `packages/istanbul-lib-coverage`. In the nyc checkout, install root
dependencies. The scripts accept explicit checkout paths:

```bash
npm run build
node --experimental-strip-types scripts/dogfood-istanbul.ts ../12-istanbul/packages/istanbul-lib-coverage
node --experimental-strip-types scripts/dogfood-nyc-self.ts ../13-nyc
```

The core experiment temporarily mutates upstream files, runs proofs sequentially,
restores each mutation, and checks source restoration. Do not edit the checkout
during the run. The nyc experiment runs upstream's own cleanup of its generated
artifacts. Both are explicit local experiments outside frequent CI.

## Core-library proof loop

Start from the real healthy six-file baseline. Add an unexecuted statement,
unexercised conditional arm, uncalled function, and uncovered line. Each must
breach its selected threshold Rule. Make Mocha fail: even though nyc emits
coverage, the adapter must REFUSE. Restore the unchanged code: GREEN.

The portfolio has six proofs and eleven independent native `json-summary`
comparisons. Every comparison checks the expected breached metrics and inspected
file count. Some mutations breach more than one metric: statement and line
coverage are related. The branch-only mutation independently demonstrates
targeted branch attribution.

## Why nyc's own dogfood is different

nyc instruments its source into `self-coverage`, uses a separate coverage global,
and collects `.self_coverage` across its child processes. Wrapping its test script
inside another nyc invocation would measure a different workflow.

The generic `istanbul()` producer therefore runs upstream's actual `npm test`,
including cleanup and instrumentation. Only successful completion permits a fresh
full-JSON export from the newly collected raw data. All four thresholds are
checked per file. This exercises merged child-process evidence and the generic
producer boundary rather than merely loading an old report.

## Findings retained

- Failed producers can emit valid JSON. A nonzero exit REFUSES, even when the
  percentages themselves are high or explain a coverage shortfall.
- Istanbul's implicit `else` arms can have empty source locations. Rejecting
  them would incorrectly refuse nyc's own dogfood. Matching branch-map and hit
  arrays still supply valid denominator evidence.
- c8 can emit `-1` for unknown branch columns after source mapping, including
  TypeScript runs. Counts remain usable; diagnostics deliberately avoid claiming
  exact uncovered coordinates. Invalid statement starting lines still REFUSE.
- Line coverage uses the maximum statement hit count on each starting line,
  not statement percentages. Two statements on one line can yield 50% statement
  coverage and 100% line coverage.
- Percentages truncate to two decimals. A 66.66% observation must not round up
  to satisfy a 66.67% threshold.
- Overall coverage can hide an uncovered file. Per-file policies expose it;
  an explicit expected-file inventory REFUSES when an excluded or uninstrumented
  file disappears entirely.
- Fresh output names are not enough for custom producers: their raw coverage
  must also be fresh. The nyc wrapper supplies a private raw-data directory;
  the upstream nyc self workflow performs its native clean step.

## Redproof's own Gate

[`coverage`](../gates/coverage.ts) runs the actual coverage-model tests through
c8, a second producer of Istanbul-format reports. It requires that model file
to be present and protects statements/lines/functions at 90% and branches at 80%.
Each Rule has a RED proof; failed production REFUSES; the healthy model passes.
This is focused model coverage, not a claim of whole-repository coverage.

## Trust boundary and further stretches

The implementation run passed 718 repository tests, six Gates protecting 32
Rules, the full repository proof portfolio, and all seven clean-consumer package
checks. The packaged adapter ran native nyc GREEN/RED checks. The expert runs are
additional local experiments, not implicit CI coverage of upstream projects.

Coverage certifies execution in the producer's chosen scope, not correctness,
assertion quality, or the absence of ignored code. Ignore directives and source
maps remain trusted inputs. Expected files cannot detect every omitted statement
inside a reported file. Summary-only reports and direct V8 profiles are not
accepted; producers must export a full Istanbul coverage map.

Further useful work includes cross-platform paths, more transpiler/source-map
variants, and independent shard-inventory attestation. The adapter does not claim
to prove that an arbitrary custom producer collected every required shard.
