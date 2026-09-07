# Execution isolation

Proofs intentionally modify a workspace. Redproof supports two execution modes for controlling that risk.

Copies is the default. Configure the mode in `redproof.config.ts`.

## In-place mode

```ts
import { defineConfig } from 'redproof';

export default defineConfig({
  execution: {
    mode: 'in-place',
  },
});
```

The proof runs directly against the project root:

```text
workspace
   ↓
mutation
   ↓
Check
   ↓
undo
```

Gates run sequentially in this mode so two proofs do not mutate the same workspace concurrently.

Use in-place mode when the workspace is disposable or when fast local feedback matters more than stronger process/filesystem isolation.

## Copies mode

```ts fragment
export default defineConfig({
  execution: {
    mode: 'copies',
    maxAtOnce: 4,
  },
});
```

Redproof creates a private working copy for each Gate, outside the project. A copy inside the project would still expose the project's own configuration files to tools that search parent directories.

```text
project                    temporary directory
                              ├── Gate A copy + child process
                              ├── Gate B copy + child process
                              └── Gate C copy + child process
```

`node_modules` is not copied. Redproof links it into each copy so module resolution still works.

Different Gates can run in parallel up to `maxAtOnce`.

Proofs inside one Gate remain sequential and reuse that Gate copy.

## Undo and baseline verification

Built-in and custom mutations return an undo operation.

Inside a copied Gate workspace, Redproof uses undo to cheaply return to the baseline between proofs:

```text
baseline
   ↓
mutation
   ↓
Check
   ↓
undo
   ↓
verify against baseline
```

The workspace verification is independent of the mutation's undo logic.

If the copy is still different after undo, Redproof reports an infrastructure error and does not reuse that workspace.

This gives undo two roles:

- in-place: restore the working project
- copies: efficiently reuse the Gate copy

In copies mode, baseline verification adds an independent safety check around that undo.

## What belongs inside the copy?

A Check or external tool should avoid leaving unrelated cache or build artifacts when possible.

For example, a test runner that leaves cache files can cause baseline verification to report a stale workspace. Prefer configuring the tool to disable those side effects for proof execution rather than weakening Redproof's verification.

## Choosing a mode

Start with:

```text
default                → copies
CI / destructive proof → copies
parallel Gates         → copies
Gate needs the real path → in-place
```

The public Gate, Rule, Check, and Proof model does not change between modes.
