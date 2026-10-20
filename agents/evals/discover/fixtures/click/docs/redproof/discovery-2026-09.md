# Redproof discovery — Click (2026-09-12)

Reviewed at commit `2247b35ea1c47c727d7a06e51fa280e12a863ff6`. First brownfield pass, claims-first.

## What to protect

| Gate | Protected outcome | Choice |
| --- | --- | --- |
| param-resolution | An option's value comes from the command line, then the envvar, then the default, in that order | Design this |
| deprecation-cycle | Anything removed was first deprecated with a warning for at least one feature release | Design this |
| completion-stable | Shell completion output format stays stable for supported shells | Later |

## Gate briefs

### param-resolution

```text
Gate param-resolution (draft)
  R1  A value given on the command line wins over envvar and default
  R2  An envvar wins over the default when auto_envvar_prefix or envvar is set
  Check: tests/test_options.py, proved against a swapped resolution order
```

- Policy source: `docs/options.md`, section on values from environment variables.
- Policy status: proposed. Stage authorization: approved-for-design.

### deprecation-cycle

```text
Gate deprecation-cycle (draft)
  R1  Every removal listed in CHANGES.md has an earlier deprecation entry
  Check: a CHANGES.md scan, proved against an injected removal without a deprecation
```

- Policy source: `CHANGES.md` and the Pallets deprecation policy.
- Policy status: proposed. Stage authorization: approved-for-design.

### completion-stable

- Deferred: low reported breakage; revisit if completion issues appear.
- Policy status: deferred. Stage authorization: pending.

## Not yet examined

- `CliRunner` isolation (stdin/stdout/env restored after invoke).
- Type conversion errors and their messages.
