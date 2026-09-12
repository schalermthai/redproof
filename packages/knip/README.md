# @redproof/knip

Turn Knip issue categories into independently provable Redproof Rules.
Requires Node 24 and Knip 6.35.1 or later in the 6.x series.

```bash
npm install --save-dev redproof @redproof/knip knip
```

```ts
import { knip } from '@redproof/knip';
import { defineGate } from 'redproof';

const adapter = knip({
  configFile: 'knip.json',
  rules: {
    unusedFiles: 'files',
    unusedExports: 'exports',
    unusedDependencies: 'dependencies',
    missingDependencies: 'unlisted',
  },
});

export default defineGate({ id: 'unused-code', adapter });
```

Aliases are local property names; values remain Knip's native category keys.
Generated Rule IDs describe the finding, independently of the alias. For example,
`adapter.rules.unusedFiles.id` is `knip/unused-files`.

| Native selector | Generated Rule ID |
|---|---|
| `files` | `knip/unused-files` |
| `dependencies` | `knip/unused-dependencies` |
| `devDependencies` | `knip/unused-dev-dependencies` |
| `optionalPeerDependencies` | `knip/referenced-optional-peer-dependencies` |
| `unlisted` | `knip/undeclared-dependencies` |
| `binaries` | `knip/undeclared-command-dependencies` |
| `unresolved` | `knip/unresolved-imports` |
| `exports` | `knip/unused-exports` |
| `types` | `knip/unused-exported-types` |
| `nsExports` | `knip/unreferenced-exports-in-used-namespaces` |
| `nsTypes` | `knip/unreferenced-types-in-used-namespaces` |
| `enumMembers` | `knip/unused-exported-enum-members` |
| `namespaceMembers` | `knip/unused-exported-namespace-members` |
| `duplicates` | `knip/duplicate-exports` |
| `catalog` | `knip/unused-catalog-entries` |
| `catalogReferences` | `knip/unresolved-catalog-references` |
| `cycles` | `knip/circular-imports` |

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

Options:

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
six categories plus GREEN and REFUSE. See
[the expert exercise](https://github.com/schalermthai/redproof/blob/main/docs/knip-expert-dogfood.md) for independent controls.
