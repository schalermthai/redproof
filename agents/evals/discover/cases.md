# Discover eval — proposed cases (draft for sign-off)

Each case runs `/redproof:discover` headless (`claude -p --plugin-dir <built bundle>`)
inside a fresh copy of a pinned open-source checkout. The run ends when discover
launches the review UI (report ready) or the session ends.

## Workspaces

| Repo | Pinned SHA | Why |
| --- | --- | --- |
| `sindresorhus/ky` | `3541888878c4d303a8bc2ad61815f4e048f55a5d` | Small TS lib, ESLint + tests; clear product claims (retries, timeouts, hooks) |
| `expressjs/express` | `a419aa7350389a275ab45fde2e849ed1f02449ef` | Mature JS framework; public API compatibility, middleware ordering |
| `pallets/click` | `2247b35ea1c47c727d7a06e51fa280e12a863ff6` | Python + pytest; CLI parsing guarantees, documented deprecations |

Variant `followup` adds one synthetic fixture file to the checkout:
`docs/redproof/discovery-2026-09.md`, a prior discovery handoff listing two Gates
the maintainer chose for design and one marked Later. I'll write those three
fixtures after you approve this list.

## Cases

| id | tags | workspace |
| --- | --- | --- |
| ky-broad | ky, broad | ky |
| ky-narrow | ky, narrow | ky |
| ky-priority | ky, priority | ky |
| ky-followup | ky, followup | ky + prior discovery |
| ky-timeboxed | ky, timeboxed | ky |
| express-broad | express, broad | express |
| express-narrow | express, narrow | express |
| express-priority | express, priority | express |
| express-followup | express, followup | express + prior discovery |
| express-timeboxed | express, timeboxed | express |
| click-broad | click, broad | click |
| click-narrow | click, narrow | click |
| click-priority | click, priority | click |
| click-followup | click, followup | click + prior discovery |
| click-timeboxed | click, timeboxed | click |

### ky-broad
```text
/redproof:discover I maintain ky and haven't used Redproof before. Find what this project should protect. Don't change any code.
```

### ky-narrow
```text
/redproof:discover Only look at ky's retry behaviour (retry limits, Retry-After handling, which methods and status codes retry). What should we protect there? Don't change any code.
```

### ky-priority
```text
/redproof:discover We keep shipping regressions in how hooks (beforeRequest, afterResponse, beforeRetry) interact with timeouts. That's my top worry, but tell me if something else in ky matters more. Don't change any code.
```

### ky-followup
```text
/redproof:discover We ran discovery last month — see docs/redproof/discovery-2026-09.md. What's changed since, and what's still unprotected? Don't change any code.
```

### ky-timeboxed
```text
/redproof:discover I have about ten minutes. What are the top three things ky should protect, and which one should I start with? Don't change any code.
```

### express-broad
```text
/redproof:discover I'm a maintainer of Express and new to Redproof. What should this project protect? Don't change any code.
```

### express-narrow
```text
/redproof:discover Focus only on the router: path matching, parameter parsing and middleware ordering. What should we protect there? Don't change any code.
```

### express-priority
```text
/redproof:discover My biggest worry is accidentally breaking the public req/res API for existing apps between minor versions. Start there, but flag anything more important. Don't change any code.
```

### express-followup
```text
/redproof:discover We did a discovery pass last month (docs/redproof/discovery-2026-09.md). What's changed, and what's still not protected? Don't change any code.
```

### express-timeboxed
```text
/redproof:discover Quick version please: the three most important things Express should protect and where to start. Don't change any code.
```

### click-broad
```text
/redproof:discover I maintain Click and haven't used Redproof. Find what this project should protect. Don't change any code.
```

### click-narrow
```text
/redproof:discover Only consider option and argument parsing — defaults, envvar fallback, multiple/nargs, and type conversion. What should be protected? Don't change any code.
```

### click-priority
```text
/redproof:discover We deprecate things with warnings for a release before removing them, and I'm worried we don't actually honour that. Start there, but tell me if something matters more. Don't change any code.
```

### click-followup
```text
/redproof:discover We ran Redproof discovery last month — notes are in docs/redproof/discovery-2026-09.md. What's changed and what's still unprotected? Don't change any code.
```

### click-timeboxed
```text
/redproof:discover Ten minutes, top three things Click should protect, and which to do first. Don't change any code.
```
