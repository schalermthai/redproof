# VS Code integration

You can integrate Redproof with VS Code without a dedicated extension.

## Problem matcher

Use the compact reporter:

```bash
redproof check --reporter=compact
```

It produces location-oriented lines such as:

```text
src/domain/order.ts:4:1: error redproof[architecture/domain-no-infrastructure]: Domain code imports infrastructure code.
```

A ready-to-copy VS Code task is included at:

```text
examples/vscode/tasks.json
```

The task problem matcher can surface Redproof breaches in the Problems panel and make file locations clickable.

## SARIF

For richer analysis output, create a SARIF file:

```bash
redproof check \
  --reporter=sarif \
  --outputFile=.redproof/results.sarif
```

Open that artifact with a VS Code SARIF viewer if your workflow already uses SARIF.

## JSON for custom editor integrations

For a future or custom Redproof extension, prefer the JSON report rather than parsing terminal output:

```bash
redproof check \
  --reporter=json \
  --outputFile=.redproof/results.json
```

The JSON report preserves Redproof concepts that do not map cleanly to ordinary editor diagnostics, including:

```text
REFUSE
undecided Rules
unknown Rules
non-countable Checks
proof infrastructure errors
```

This is the intended machine-facing boundary for Redproof-specific integrations.

## Recommended local task

A simple workflow is:

```text
redproof check --reporter=compact
    ↓
VS Code Problems
    ↓
open source location
```

Use `redproof prove` separately when you want to verify the Gate itself rather than continuously checking the current project state.
