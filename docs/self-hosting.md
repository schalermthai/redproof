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
| `repository-policy` | Package inventories, versions, exports, schemas, CI/release verification, and documentation links | A native Check over a pure policy model |

The current suite has 20 Rules. Its 25 proofs add one focused defect at a time.
Every Gate has a GREEN proof, and `repository-policy` also has a REFUSE proof.

## How a Gate file is organised

A Gate file states what is protected. It holds no plumbing. Read one and you see
the Rules, the Check that evaluates them, and the Proofs that break them.

Three directories separate the three jobs:

```text
gates/*.ts            what is protected, and how each Rule is broken
gates/checks/*.ts     how a Check gathers input and reports findings
gates/support/*.ts    pure models and shared plumbing
```

`gatesRoot` is `gates/*.ts`, so only the top level is discovered. The other two
directories are libraries, not Gates.

The shared plumbing is `gates/support/scanning.ts`. Every native Check repeats
the same four steps. It stamps the scan window, counts what it inspected, turns
findings into breaches, and REFUSES when the input cannot be read. `scanning`
holds that once, so a Check states only what is specific to it:

```text
export function repositoryPolicy<R extends RuleRef>(options: Options<R>): Check<R> {
  return scanning({
    description: 'evaluate package, release, and documentation contracts',
    source: 'repository policy',
    gather: root => readSnapshot(root, options),
    inspected: state => state.manifests.length + state.markdown.length,
    breaches: state => evaluateRepositoryPolicy(state).map(toBreach),
    whenUnavailable: {
      code: 'repository-policy-unavailable',
      message: 'Repository policy inputs could not be read.',
    },
  });
}
```

`scanning` also takes an optional `delegate`. The `architecture` Gate uses it to
run the dependency-cruiser Adapter first. A REFUSE from the Adapter wins, and its
breaches are carried, so one Gate reports both the module graph and the effect
scan.

## Functional core and imperative shell

`packages/redproof/src/domain/**` and every `packages/redproof/src/*/core/**`
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
