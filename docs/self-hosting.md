# Self-hosting Redproof

Redproof uses Redproof to protect the repository's most important frequent
contracts. The self-hosted project is configured by `redproof.config.ts` and
runs four Gates concurrently in isolated copies.

## Frequent Gates

| Gate | What it protects | Implementation |
| --- | --- | --- |
| `architecture` | Functional-core/imperative-shell direction, cycles, package boundaries, approved effect sites, and I/O-free core tests | `@redproof/dependency-cruiser` plus a TypeScript AST effect scan |
| `static-contracts` | Workspace types, executable documentation examples, and the existing documentation-fragment budget | `redproof/command` with three bounded-parallel commands |
| `test-health` | Complete test success and zero skipped tests | `@redproof/testing` with Node's JUnit reporter |
| `repository-policy` | Package inventories, versions, exports, schemas, CI/release verification, and documentation links | A native snapshot shell with a pure policy model |

The current suite has 20 Rules. Its 24 proofs add one focused defect at a time
and include a clean GREEN proof for every Gate.

## Functional core and imperative shell

`packages/redproof/src/domain/**` and `packages/redproof/src/runtime/core/**`
form the protected functional core. They may consume values and return policy
decisions, but they cannot read files, spawn processes, observe clocks or
environment state, call reporters, or import runtime shell modules.

Effectful source is confined to the explicit allowlist in
`gates/support/effects-model.ts`. Adding a new filesystem, subprocess, process,
clock, randomness, timer, or networking site therefore requires an intentional
architecture change instead of spreading silently.

The pure policy lane is:

```bash
npm run test:core
```

Those tests use plain values. The architecture Gate rejects filesystem,
subprocess, temporary-workspace, and fixture helpers in the designated core
tests.

## Running the suite

Build once before a standalone self-hosting run because some repository tests
exercise the packages through their built public exports:

```bash
npm run build
npm run self:describe
npm run self:check
npm run self:prove
```

The normal repository entrypoint runs the self-check and proofs after its
existing type, documentation, test, and reference-fixture verification:

```bash
npm run check
```

Machine-readable output can be retained under the ignored `.redproof/`
directory:

```bash
npm run self:check -- \
  --reporter=json \
  --outputFile=.redproof/self-check.json
```

The test Gate intentionally runs the complete suite, including the Stryker
integration. Environments that prohibit local listening sockets cannot execute
that integration faithfully; CI and ordinary development hosts must keep the
capability rather than silently excluding the test.

Installed-tarball verification remains a slower release contract:

```bash
npm run verify:package
```
