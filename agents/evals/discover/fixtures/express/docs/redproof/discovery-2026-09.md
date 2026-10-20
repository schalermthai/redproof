# Redproof discovery — Express (2026-09-12)

Reviewed at commit `a419aa7350389a275ab45fde2e849ed1f02449ef`. First brownfield pass, claims-first.

## What to protect

| Gate | Protected outcome | Choice |
| --- | --- | --- |
| middleware-order | Middleware and route handlers run in registration order, and `next(err)` skips to error handlers | Design this |
| res-api-compat | Public `res` methods keep their documented signatures across minor releases | Design this |
| query-parser-default | The default query parser setting does not change silently | Later |

## Gate briefs

### middleware-order

```text
Gate middleware-order (draft)
  R1  Handlers registered with app.use / app.METHOD run in registration order
  R2  next(err) skips non-error handlers until an error handler runs
  Check: test/app.router.js and test/app.use.js, proved against reordered stacks
```

- Policy source: `Readme.md` and the routing guide.
- Policy status: proposed. Stage authorization: approved-for-design.

### res-api-compat

```text
Gate res-api-compat (draft)
  R1  Documented res methods exist with their documented arity
  Check: a signature snapshot compared against the previous minor release
```

- Policy source: `History.md` deprecation entries.
- Policy status: proposed. Stage authorization: approved-for-design.

### query-parser-default

- Deferred: needs a maintainer decision on whether the default is a promise.
- Policy status: deferred. Stage authorization: pending.

## Not yet examined

- `req` property getters (`req.ip`, `req.protocol`) behind proxies.
- View rendering and `app.render` caching.
