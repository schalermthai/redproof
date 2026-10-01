# VS Code integration

You can integrate Redproof with VS Code without a dedicated extension.

## Problem matcher

Use the compact reporter:

```bash
npx redproof check --reporter=compact
```

It produces location-oriented lines such as:

```text
src/domain/order.ts:4:1: error redproof[architecture/domain-no-infrastructure]: Domain code imports infrastructure code.
```

With Redproof installed and your Gates configured:

1. Copy the [example task](https://github.com/schalermthai/redproof/blob/main/examples/vscode/tasks.json) into your project's
   `.vscode/tasks.json`. If that file already exists, add the `redproof` task to
   its `tasks` array instead of replacing the file.
2. Open the project root in VS Code. From the Command Palette, choose
   **Tasks: Run Task**, then **redproof**.
3. Open the **Problems** panel. Breaches with source locations become clickable
   entries that take you to the affected code.

## SARIF

For richer analysis output, create a SARIF file:

```bash
npx redproof check \
  --reporter=sarif \
  --outputFile=.redproof/results.sarif
```

Open that artifact with a VS Code SARIF viewer if your workflow already uses SARIF.

## JSON for custom editor integrations

For a future or custom Redproof extension, prefer the JSON report rather than parsing terminal output:

```bash
npx redproof check \
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
npx redproof check --reporter=compact
    ↓
VS Code Problems
    ↓
open source location
```

Use `redproof prove` separately when you want to verify the Gate itself rather than continuously checking the current project state.
