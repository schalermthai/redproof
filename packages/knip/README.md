# @redproof/knip

Turn Knip issue categories into independently provable Redproof Rules.

## Install

Requires Node.js 24 or later and Knip 6.35.1 or later in the 6.x series.

```bash
npm install --save-dev redproof @redproof/knip knip
```

## Features

- Gives each selected issue category its own Rule, rather than one command-exit verdict.
- Catches selected warning findings even when Knip exits zero.
- Refuses disabled selected categories or incomplete reports instead of claiming a pass.
- Supports workspace selection, production/strict modes, timeouts, and output limits.

## Use

Start with a working Knip setup and a
[Redproof configuration](https://github.com/schalermthai/redproof#install).
Save this as `gates/unused-code.ts`. Set `configFile: 'knip.json'` if you want to
name a configuration explicitly; otherwise Knip discovers it normally.

```ts
import { knip } from '@redproof/knip';
import { defineGate } from 'redproof';

const adapter = knip({
  rules: {
    unusedFiles: 'files',
    unusedExports: 'exports',
    unusedDependencies: 'dependencies',
    missingDependencies: 'unlisted',
  },
});

export default defineGate({ id: 'unused-code', adapter });
```

```bash
npx redproof check gates/unused-code.ts
```

This example checks the selected categories; it does not include proofs. Export
a `defineProofs` suite before running `npx redproof prove gates/unused-code.ts`.
For mutations that introduce unused files and exports, see
[Redproof's Knip Gate and proofs](https://github.com/schalermthai/redproof/blob/main/gates/unused-code.ts).

## Supported Rules

Aliases are local property names; values remain Knip's native category keys.
Generated Rule IDs describe the finding, independently of the alias. For example,
`adapter.rules.unusedFiles.id` is `knip/unused-files`.

Each selected category requires zero issues in Knip's configured scope.

| Native selector | Generated Rule ID | Finding it rejects |
|---|---|---|
| `files` | `knip/unused-files` | Unused files. |
| `dependencies` | `knip/unused-dependencies` | Unused production dependencies. |
| `devDependencies` | `knip/unused-dev-dependencies` | Unused development dependencies. |
| `optionalPeerDependencies` | `knip/referenced-optional-peer-dependencies` | Referenced optional peers without a direct dependency declaration. |
| `unlisted` | `knip/undeclared-dependencies` | Used dependencies missing from declarations. |
| `binaries` | `knip/undeclared-command-dependencies` | Used commands missing a dependency declaration. |
| `unresolved` | `knip/unresolved-imports` | Imports that cannot be resolved. |
| `exports` | `knip/unused-exports` | Unused exports. |
| `types` | `knip/unused-exported-types` | Unused exported types. |
| `nsExports` | `knip/unreferenced-exports-in-used-namespaces` | Unreferenced exports within a used namespace import. |
| `nsTypes` | `knip/unreferenced-types-in-used-namespaces` | Unreferenced types within a used namespace import. |
| `enumMembers` | `knip/unused-exported-enum-members` | Unused exported enum members. |
| `namespaceMembers` | `knip/unused-exported-namespace-members` | Unused exported TypeScript namespace members. |
| `duplicates` | `knip/duplicate-exports` | Duplicate exports. |
| `catalog` | `knip/unused-catalog-entries` | Unused dependency catalog entries. |
| `catalogReferences` | `knip/unresolved-catalog-references` | Unresolved dependency catalog references. |
| `cycles` | `knip/circular-imports` | Circular imports. |

Optional-peer findings concern referenced optional peers without a direct
dependency or development-dependency declaration, not unused peers. Namespace
import findings mean an individual export lacks a reference even though the
namespace object is used; they do not establish that dynamic consumers never
use that export. These differ from exported TypeScript namespace members.

Breach diagnostic codes retain the native category (for example, `exports`),
so reports can still be compared directly with Knip evidence. Generated IDs
replace the pre-release `knip/<native-category>` names; update any hard-coded
Rule references or proof expectations. Native selectors are unchanged.

Knip configuration determines analysis scope, plugins, ignore patterns and
enabled categories. Selection here does not override disabled Knip rules.
For cycles, explicitly enable `cycles` in the Knip config's `include` list.
An enabled warning still breaches a selected zero-issue Rule even if Knip exits
zero. Unselected issues never become breaches.

## Options

| Option | Meaning |
|---|---|
| `cwd` | Project working directory, relative to the Gate root; default `.`. |
| `configFile` | Explicit config path relative to the Gate root; otherwise native discovery. |
| `cli` | Optional Node CLI entry relative to the Gate root, for checking Knip source itself. Normally resolves installed Knip from the selected project. |
| `workspace` | Native Knip workspace selector. |
| `production`, `strict` | Native production/strict analysis; strict implies production in Knip. |
| `includeEntryExports` | Also inspect public entrypoint exports. |
| `treatConfigHintsAsErrors` | Require attention to native configuration hints. |
| `timeoutMs` | Execution deadline, default 60 seconds. |
| `maxOutputBytes` | Captured stdout/stderr limit and separate report-size limit; default 10 MiB each. |

Explicit filesystem paths are confined inside the Gate root, including symlink
targets. The installed executable may live in shared `node_modules`. This is
not a sandbox for Knip configuration code or plugin imports.

The adapter reads the installed Knip version from the Knip package manifest and
REFUSES an unsupported one. The `cli` option does not skip that check when the
path it names sits inside an installed Knip. A `cli` path outside an installed
Knip carries no version to read, so no version check runs for it.

The bundled custom reporter records structured issues, processed-file counts,
enabled categories and incomplete configuration status into a fresh private
artifact. Plain Knip JSON lacks the metadata needed to distinguish a healthy
empty result from disabled inspection. Configuration logs are captured separately
and cannot overwrite report evidence. The adapter does not enable Knip's cache
or fix mode.

Malformed/incomplete evidence, disabled selected categories, blocking hints,
configuration errors, unexplained failing exits and unavailable execution
REFUSE. Timeouts, signals and output overflow use Redproof's shared command
process-tree handling. A valid zero-file report remains subject to the Gate's
`emptyEvidence` policy.

Trust is scoped to Knip's configured analysis. Ignored code and custom
preprocessors can intentionally suppress findings. This adapter does not prove
whole-repository reachability or validate arbitrary configuration code.

Development: the package owns its Adapter TCK registration, native tests and
pure parser tests. The repository's `unused-code` Gate supplies RED proofs for
six categories plus GREEN and REFUSE.

## Documentation

See [all built-in Adapters and the comparison with Command Checks](https://github.com/schalermthai/redproof/blob/main/docs/built-in-adapters.md).
