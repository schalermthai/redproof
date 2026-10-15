# Redproof discovery — ky (2026-09-12)

Reviewed at commit `3541888878c4d303a8bc2ad61815f4e048f55a5d`. First brownfield pass, claims-first.

## What to protect

| Gate | Protected outcome | Choice |
| --- | --- | --- |
| retry-contract | Retries stop at the configured limit and only for the documented methods and status codes | Design this |
| timeout-honoured | A request never runs past `timeout`, including time spent in retries | Design this |
| hook-order | Hooks run in the documented order and a `beforeRequest` hook can short-circuit with a Response | Later |

## Gate briefs

### retry-contract

```text
Gate retry-contract (draft)
  R1  A request is attempted at most retry.limit + 1 times
  R2  Only methods in retry.methods are retried
  R3  Retry-After is honoured up to retry.maxRetryAfter
  Check: existing retry tests in test/retry.ts, proved against mutated limits
```

- Policy source: `readme.md`, section `retry`.
- Policy status: proposed. Stage authorization: approved-for-design.

### timeout-honoured

```text
Gate timeout-honoured (draft)
  R1  The total request time including retries does not exceed timeout
  Check: timeout tests in test/main.ts with a slow local server
```

- Policy source: `readme.md`, section `timeout`.
- Policy status: proposed. Stage authorization: approved-for-design.

### hook-order

- Deferred: the maintainer wants to revisit after the next hooks refactor.
- Policy status: deferred. Stage authorization: pending.

## Not yet examined

- Error classes (`HTTPError`, `TimeoutError`) and their public fields.
- Response body helpers (`.json()` on empty bodies).
