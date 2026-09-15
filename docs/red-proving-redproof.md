# Redproof proves Redproof

This repository runs Redproof on itself. Six Gates hold 39 Rules and 61 Proofs.
They are the controls that the real CI and release workflows use, not a
separate showcase suite.

Every push asks two questions:

```text
npm run self:check   does the repository satisfy its guardrails now?
npm run self:prove   can each guardrail still detect the defect it names?
```

The important model is:

```text
healthy repository   ──▶ same Gate ──▶ PASS
controlled defect    ──▶ same Gate ──▶ FAIL the targeted Rule
unavailable evidence ──▶ same Gate ──▶ REFUSE
```

A RED proof is not satisfied by any failure. The Rule it names must breach.
A GREEN proof shows the healthy repository passes. A REFUSE proof shows the
Check declines to guess when its evidence is missing.

## The six Gates

```text
architecture         module graph and functional-core effect boundaries   16 Rules   25 Proofs
static-contracts     types, documentation examples, fragment budget         3 Rules    4 Proofs
test-health          every test passes, none is skipped                    2 Rules    4 Proofs
adapter-contracts    five promises every built-in Adapter keeps            5 Rules    9 Proofs
repository-policy    packages, versions, CI, documentation links, lockfile 7 Rules   10 Proofs
unused-code          files, exports, and dependencies stay connected       6 Rules    9 Proofs
```

Each Gate is one file under [`gates/`](../gates). The rest of this page shows
the ideas inside those files.

## A Gate file is configuration

Gate files follow three directories:

```text
gates/*.ts            what is protected, and how each Rule is broken
gates/checks/*.ts     how a Check gathers input and reports findings
gates/support/*.ts    pure models and shared plumbing
```

A Gate file states Rules, one Check, and Proofs. Nothing else. The
[`unused-code`](../gates/unused-code.ts) Gate is the whole idea in one screen:

```ts
import { knip } from '@redproof/knip';
import { defineGate, defineProofs, locate, mutate, proof } from 'redproof';

const adapter = knip({
  configFile: 'knip.json',
  rules: { files: 'files', exports: 'exports', dependencies: 'dependencies',
    devDependencies: 'devDependencies', unlisted: 'unlisted', unresolved: 'unresolved' },
});
const gate = defineGate({ id: 'unused-code', adapter });

export const proofs = defineProofs(gate, [
  proof.red(adapter.rules.files, 'finds an unreachable file in the root workspace',
    mutate.writeText('gates/support/unused-receipt.ts', 'export const unusedReceipt = 1;\n')),
  proof.red(adapter.rules.exports, 'finds an unused internal export in another package',
    mutate.appendText('packages/eslint/src/core/model.ts', '\nexport const unusedReceipt = 1;\n')),
  proof.red(adapter.rules.exports, 'finds an export that only its own file still references',
    mutate.appendText('packages/eslint/src/core/model.ts',
      '\nexport const selfUsedReceipt = 1;\nvoid selfUsedReceipt;\n')),
  proof.red(adapter.rules.dependencies, 'finds a dependency without consumers',
    mutate.jsonMerge(locate.json({ files: 'packages/knip/package.json', path: '$.dependencies' }), { 'unused-receipt': '1.0.0' })),
  proof.red(adapter.rules.devDependencies, 'finds a dev dependency without consumers',
    mutate.jsonMerge(locate.json({ files: 'packages/knip/package.json', path: '$.devDependencies' }), { 'unused-receipt': '1.0.0' })),
  proof.red(adapter.rules.unlisted, 'finds an undeclared external dependency',
    mutate.appendText('packages/knip/src/core/model.ts', "\nimport 'redproof-undeclared-receipt';\n")),
  proof.red(adapter.rules.unresolved, 'finds an unresolved internal import',
    mutate.appendText('packages/knip/src/core/model.ts', "\nimport './redproof-missing-receipt.ts';\n")),
  proof.refuse('refuses incomplete Knip configuration', mutate.writeText('knip.json', '{ invalid')),
  proof.green('accepts the maintained repository inventory'),
]);

export default gate;
```

Six Rules, seven controlled defects, one refusal, one healthy baseline. A
reader can see what the Gate promises and how each promise is tested, without
opening Knip's documentation.

## The mutation is the specification

The [`architecture`](../gates/architecture.ts) Gate protects a functional core
and an imperative shell. Core modules make decisions from values. Shell modules
read files, watch the clock, and supervise processes.

A written convention is easy to break by accident. So each boundary has a
mutation that crosses it:

```text
create two production modules that import each other
append a filesystem import to a core module
read process.cwd() inside the functional core
make a core module import its shell
make an Adapter import Redproof internals
make one Adapter import another
make a core test import a shell
```

Three of those mutations touch the same file:

```text
packages/redproof/src/run/core/exit-code.ts

+ import 'node:fs/promises';             → R2  core-no-effect-imports
+ void process.cwd();                    → R14 core-no-ambient-inputs
+ import '../shell/worker-process.ts';   → R3  core-no-shell
```

Each proof names one Rule. If the file change breaches a different Rule, the
proof fails. That is how the Gate shows it knows the difference between three
kinds of leak, not only that something went wrong.

## Two tools, one Check

The architecture Gate needs two kinds of evidence. dependency-cruiser sees the
import graph. It cannot see `process.cwd()` inside a function body. A
TypeScript syntax scan can.

The [`effectBoundaries`](../gates/checks/effect-boundaries.ts) Check runs
both. dependency-cruiser answers first. Its breaches are carried. The syntax
scan then adds its own.

```text
scanning({
  delegate:   run the dependency-cruiser Adapter first
  gather:     read every source file and every core test
  inspected:  how many files the scan read
  breaches:   ambient reads, unapproved effect modules, I/O in core tests
  whenUnavailable: REFUSE when the sources cannot be read
})
```

[`scanning`](../gates/support/scanning.ts) is the shape every native Check in
this repository repeats. A REFUSE from the delegate wins. A throw in `gather`
becomes REFUSE with the diagnostic named in `whenUnavailable`. Only findings
become breaches.

The approved effect boundaries are a list of 28 files in
[`effects-model.ts`](../gates/support/effects-model.ts). A new file that reads
the filesystem must be added to that list, on purpose, in a reviewed change.
The proof creates such a file and expects R15 to breach.

## The documentation is code

Every `ts` block in `README.md` and `docs/` compiles. The
[`static-contracts`](../gates/static-contracts.ts) Gate runs the TypeScript
compiler over them. A block that cannot stand alone is marked `ts fragment`.
That is debt, and the budget is 37. The budget cannot grow.

The RED proofs write a Markdown file with a bad example:

```text
create docs/redproof-doc-example-proof.md     with  const value: string = 1;   → R2
create docs/redproof-doc-fragment-proof.md    with  one more ```ts fragment    → R3
```

This page is checked by the Gate that this page describes.

## The test runner is described by its own arguments

The [`test-health`](../gates/test-health.ts) Gate runs every test file under
`node --test` and reads the JUnit report through `@redproof/testing`.

The file list depends on the workspace. So
[`nodeTestSuite`](../gates/checks/node-test-suite.ts) builds the arguments per
run with `runner.command` and an `args` function. The runner exposes that
builder as `argsFor`, and its description names the glob. `redproof describe`
prints:

```text
Check:
  run {tests,packages/*/test}/**/*.test.ts under node --test with a JUnit report; interpret junit-xml test results
```

The description and the arguments are built from the same `files` option, so
the sentence cannot drift from the real command.

The proofs create one failing test and one skipped test. A skipped test is not
a passing test. The Rule `noSkippedTests` breaches on it.

## The guards are guarded

An Adapter can return the right TypeScript shape and still be unsafe. It might
accept invalid options, turn a crashed tool into PASS, or drop a finding it
should report.

The [`adapter-contracts`](../gates/adapter-contracts.ts) Gate holds five
promises for every built-in Adapter. Its mutations edit the production source
of an Adapter, then expect the contract suite to notice:

```text
remove   rejectUnknownKeys(options, ['files', 'rules'], 'ESLint adapter')   → R1 options validated
replace  kind: 'unavailable'  with  kind: 'completed'                         → R2 unavailable refuses
append   import '../index.ts'  to a pure evidence model                       → R3 parsers stay pure
replace  capabilities: { todo: false, flaky: false }  with  true, true        → R4 capabilities honest
replace  if (!message.ruleId) continue;  with  if (message.ruleId) continue;  → R5 structured evidence
```

Each promise runs twice. The original contract suite runs, and the
package-owned [`@redproof/adapter-tck`](../packages/adapter-tck/README.md)
registration runs beside it. Ten commands, five Rules, in parallel.

The REFUSE proof floods a contract suite with 4 MB of output against a 1 MB
budget. The Gate refuses. It does not read a partial result.

Real-tool fixtures then prove the same promises with ESLint, dependency-cruiser,
Stryker, and Vitest against representative projects. The dependency direction
stays clean:

```text
Adapter production ──▶ redproof
Adapter tests      ──▶ @redproof/adapter-tck ──peer/types──▶ redproof
root Gate          ──▶ package-owned TCK tests
```

Redproof does not depend on the TCK. Adapter production does not import it.
The TCK does not import built-in Adapters. Two of those statements have a
proof. The architecture Gate plants a TCK import in Adapter source. The
repository-policy Gate adds the TCK to redproof's dependencies. Both must
breach.

## The release is a Rule

Dogfooding stops being convincing if it protects source code but not what
users install. The [`repository-policy`](../gates/repository-policy.ts) Gate
reads the package manifests, the release scripts, both workflows, every
Markdown link, and the lockfile.

Its mutations are the release mistakes a team actually makes:

```text
rename 'packages/testing' in the version setter              → R1 a package leaves the inventory
set one package to "0.6.1" while the rest are "0.12.0"       → R2 versions diverge
add "@redproof/adapter-tck" to redproof's dependencies       → R3 a layer boundary breaks
rename the "schema" export to "schema-off"                    → R4 a public surface is undeclared
remove "run: npm run verify:package" from ci.yml              → R5 CI drops verification
write  npm publish "$TARBALL"  without the "./"              → R5 npm reads a GitHub shorthand
link ./definitely-missing.md from a document                  → R6 a documentation link breaks
delete lightningcss-linux-x64-gnu from package-lock.json      → R7 a platform binary vanishes
rename .github/workflows/ci.yml                               → REFUSE, not PASS
```

The `npm publish` mutation records a real incident. The 0.12.0 release
published nothing, because npm reads a bare `artifacts/x.tgz` as the GitHub
shorthand `github:artifacts/x.tgz`. The Rule now pins `npm publish "./$TARBALL"`.

The release workflow packs every publishable package, installs the tarballs
into a clean consumer, and verifies runtime imports, published types, CLI
behaviour, package contents, and internal links. The same verified tarballs are
attached to the workflow run and passed to `npm publish`. Nothing is rebuilt
afterward. See the [publish workflow](../.github/workflows/publish.yml).

## CI discovers the Gates

The [CI workflow](../.github/workflows/ci.yml) does not keep a list of Gates.
A `discover` job lists `gates/*.ts`. A matrix job then runs the proofs of one
Gate per leg:

```text
discover ──▶ proofs (architecture)
         ──▶ proofs (static-contracts)
         ──▶ proofs (test-health)
         ──▶ proofs (adapter-contracts)
         ──▶ proofs (repository-policy)
         ──▶ proofs (unused-code)
```

A new Gate file joins CI by existing. It cannot be forgotten in a hand-written
list. The `repository-policy` Gate then checks that the run line of each leg is
exactly `npm run check:proofs -- gates/${{ matrix.gate }}.ts`.

Quality checks, the proof legs, and clean-consumer package verification start
together and report separately. A slow proof does not hold the other layers.

## REFUSE is a first-class outcome

Three Gates carry a REFUSE proof. Each removes the evidence the Check needs:

```text
unused-code          write  knip.json  as  { invalid
repository-policy    rename  .github/workflows/ci.yml
adapter-contracts    write 4 MB to stdout inside a 1 MB budget
```

None of those becomes PASS. None becomes a false product defect. The Gate says
it could not decide.

## Proofs run in copies

Proofs run in isolated project copies. `redproof.config.ts` sets
`execution: { mode: 'copies', maxAtOnce: 4 }`. A mutation can delete a
workflow, corrupt a lockfile, or edit Adapter source without touching the
working tree. Redproof checks that each copy returns to its baseline before it
is reused. A proof that leaves a file behind refuses with
`workspace-not-restored`.

## Run it

Describe the Gates as an executable specification:

```bash
npm run self:describe
```

Check the current repository:

```bash
npm run self:check
```

Run every controlled defect, healthy baseline, and refusal:

```bash
npm run self:prove
```

The complete delivery check adds types, documentation examples, native tests,
and the real-tool fixtures:

```bash
npm run check
```

The proof report puts the claim and the outcome side by side:

```text
✓ architecture / detects a production dependency cycle expected=red actual=fail
✓ adapter-contracts / refuses when a contract suite floods its output budget expected=refuse actual=refuse
✓ repository-policy / accepts the current repository contracts expected=green actual=pass
```

## Why this matters when agents write code

An agent can change more code, configuration, and documentation in one pass
than a person usually touches at once. It can also make plausible mistakes at
the same speed. A guardrail that still works tells the agent what crossed a
boundary, with evidence it can act on.

A guardrail that has quietly stopped working tells it nothing. A stale glob, an
ignored report field, or a parser that turns a crash into PASS makes a pipeline
confidently wrong. The proofs on this page exist so that cannot happen in
silence.

## Next

- **[The Contract-to-Gate method](contract-to-gate.md)** to turn a quality idea
  into a Rule, a Check, and Proofs.
- **[Gating Adapter contracts](adapter-contract-gates.md)** for the design of
  the `adapter-contracts` Gate.
- **[Custom Adapter](custom-adapter.md)** for the guidelines those contracts
  enforce.
