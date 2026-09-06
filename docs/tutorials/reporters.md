# Reporters

Redproof separates execution from presentation. One Check run can be rendered for humans, CI systems, or IDE tooling.

## Default terminal reporter

```bash
redproof check
```

or explicitly:

```bash
redproof check --reporter=default
```

Healthy projects stay compact. Failed Rules expand into concrete Breaches and diagnostics.

Use `--verbose` to expand successful Rules as well.

## Compact reporter

```bash
redproof check --reporter=compact
```

Example:

```text
src/domain/order.ts:4:1: error redproof[architecture/domain-no-infrastructure]: Domain code imports infrastructure code.
```

The compact format is useful for editor problem matchers and line-oriented tooling.

Locationless breaches are still reported, but Redproof does not invent a source file just to create a diagnostic location.

## JSON reporter

```bash
redproof check \
  --reporter=json \
  --outputFile=.redproof/results.json
```

JSON is the machine-readable Redproof report. It preserves Redproof-specific states such as:

```text
Gate: pass | fail | refuse
Rule: held | breached | undecided | unknown
Breaches: exact | not-countable
```

`redproof prove` also supports JSON:

```bash
redproof prove \
  --reporter=json \
  --outputFile=.redproof/proofs.json
```

The JSON schemas live under:

```text
packages/redproof/schema/check-report-v1.schema.json
packages/redproof/schema/prove-report-v1.schema.json
```

## SARIF reporter

```bash
redproof check \
  --reporter=sarif \
  --outputFile=.redproof/results.sarif
```

SARIF is intended for interoperability with analysis tools.

Redproof maps:

```text
Breach  → SARIF result
REFUSE  → tool execution notification
```

A refusal is not emitted as a fake Rule violation.

## Multiple reporters

A single Check can produce terminal output and machine artifacts together:

```bash
redproof check \
  --reporter=default \
  --reporter=json:.redproof/results.json \
  --reporter=sarif:.redproof/results.sarif
```

At most one reporter writes to stdout. Additional reporters should specify output files.

This is useful in CI:

```text
default → job log
JSON    → Redproof automation/artifact
SARIF   → analysis tooling
```

## Output file paths

Relative `outputFile` paths are resolved from the configured Redproof project root, not from an arbitrary shell working directory.

## Next

- **[VS Code integration](vscode.md)**
- **[Execution isolation](execution-isolation.md)**
