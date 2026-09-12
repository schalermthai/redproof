import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { dependencyCruiser } from '@redproof/dependency-cruiser';
import { withWorkspace } from '../helpers/workspace.ts';

/**
 * The adapter loads dependency-cruiser from the Gate root when the root is
 * dependency-cruiser itself. A workspace shaped like that package therefore
 * drives the real loading path with a scripted cruise result, so refusals and
 * option forwarding can be checked without a real dependency graph.
 */
type FakeProject = {
  readonly cruise: string;
  readonly config?: string;
};

const CONFIGURED_RULE = "export default async function extractConfig() { return { forbidden: [{ name: 'no-new-debt' }] }; }\n";

async function writeFakeDependencyCruiser(root: string, project: FakeProject): Promise<void> {
  await mkdir(join(root, 'config-utl'), { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({
    name: 'dependency-cruiser',
    type: 'module',
    exports: {
      '.': './main.mjs',
      './config-utl/extract-depcruise-config': './config-utl/config.mjs',
      './config-utl/extract-depcruise-options': './config-utl/options.mjs',
    },
  }), 'utf8');
  await writeFile(join(root, 'main.mjs'), project.cruise, 'utf8');
  await writeFile(join(root, 'config-utl/config.mjs'), project.config ?? CONFIGURED_RULE, 'utf8');
  await writeFile(
    join(root, 'config-utl/options.mjs'),
    'export default async function extractOptions() { return { cache: true, exclude: "vendor" }; }\n',
    'utf8',
  );
  await writeFile(join(root, '.dependency-cruiser.mjs'), 'export default {};\n', 'utf8');
}

const cruiseReporting = (summary: string) => `export async function cruise(files, options) {
  return { output: JSON.stringify({ summary: ${summary} }) };
}
`;

const noViolations = cruiseReporting('{ totalCruised: 7, violations: [] }');

const oneViolation = cruiseReporting(`{
    totalCruised: 3,
    violations: [{
      rule: { name: 'no-new-debt', severity: 'error' },
      from: 'src/domain/order.ts',
      to: 'src/infrastructure/db.ts',
    }],
  }`);

const adapterFor = (options: {
  readonly knownViolationsFile?: string;
  readonly rules?: Readonly<Record<string, string>>;
  readonly files?: readonly string[];
}) => dependencyCruiser({
  configFile: '.dependency-cruiser.mjs',
  ...(options.knownViolationsFile ? { knownViolationsFile: options.knownViolationsFile } : {}),
  ...(options.files ? { files: options.files } : {}),
  rules: options.rules ?? { noNewDebt: 'no-new-debt' },
});

type Adapter = ReturnType<typeof adapterFor>;

const run = (adapter: Adapter, root: string) => adapter.check.run({
  root,
  rules: Object.values(adapter.rules).map(rule => rule.id),
});

test('the adapter adopts each named dependency-cruiser rule under a Redproof Rule of its own', () => {
  const adapter = dependencyCruiser({
    files: ['src', 'test'],
    rules: { domain: 'domain-no-infrastructure' },
  });

  assert.equal(adapter.rules.domain.id, 'dependency-cruiser/domain-no-infrastructure');
  assert.equal(
    adapter.rules.domain.description,
    'dependency-cruiser rule domain-no-infrastructure must hold.',
  );
  assert.equal(
    adapter.check.description,
    'run dependency-cruiser against src, test and report configured rule breaches',
  );
  assert.equal(
    dependencyCruiser({ rules: { domain: 'domain-no-infrastructure' } }).check.description,
    'run dependency-cruiser against src and report configured rule breaches',
  );
});

test('a clean cruise passes and reports how many modules dependency-cruiser inspected', async () => {
  await withWorkspace(async root => {
    await writeFakeDependencyCruiser(root, { cruise: noViolations });

    const result = await run(adapterFor({}), root);

    assert.equal(result.verdict, 'pass');
    assert.equal(result.scan.inspected, 7);
    assert.equal(result.scan.source, 'dependency-cruiser');
  });
});

test('a violation of an adopted rule fails the Gate and keeps its dependency evidence', async () => {
  await withWorkspace(async root => {
    await writeFakeDependencyCruiser(root, { cruise: oneViolation });

    const result = await run(adapterFor({}), root);

    assert.equal(result.verdict, 'fail');
    if (result.verdict !== 'fail') return;
    assert.equal(result.breaches.length, 1);
    assert.equal(result.breaches[0]?.rule, 'dependency-cruiser/no-new-debt');
    assert.equal(result.breaches[0]?.location?.file, 'src/domain/order.ts');
    assert.equal(result.scan.inspected, 3);
  });
});

test('the run keeps the configured cruise options, disables caching, and asks for a structured result', async () => {
  await withWorkspace(async root => {
    await writeFakeDependencyCruiser(root, {
      cruise: cruiseReporting(`{
    totalCruised: 1,
    violations: (options.cache === false && options.outputType === 'json' && options.exclude === 'vendor')
      ? []
      : [{ rule: { name: 'no-new-debt' }, from: 'options', to: 'were not forwarded' }],
  }`),
    });

    const result = await run(adapterFor({ files: ['src', 'gates'] }), root);

    assert.equal(
      result.verdict,
      'pass',
      'a cached or unstructured run could report a stale, unreadable graph',
    );
  });
});

test('a Rule the dependency-cruiser configuration does not define REFUSES instead of passing', async () => {
  await withWorkspace(async root => {
    await writeFakeDependencyCruiser(root, {
      cruise: "export async function cruise() { throw new Error('cruise must not run'); }\n",
    });

    const result = await run(
      adapterFor({ rules: { noNewDebt: 'no-new-debt', absent: 'rule-nobody-defined' } }),
      root,
    );

    assert.equal(result.verdict, 'refuse');
    if (result.verdict !== 'refuse') return;
    assert.equal(result.why.code, 'dependency-cruiser-rule-missing');
    assert.equal(result.why.location?.file, '.dependency-cruiser.mjs');
    assert.match(result.why.detail ?? '', /rule-nobody-defined/u);
    assert.doesNotMatch(result.why.detail ?? '', /no-new-debt/u);
    assert.equal(result.scan.inspected, null);
  });
});

test('a Rule disabled in dependency-cruiser REFUSES instead of falsely passing', async () => {
  await withWorkspace(async root => {
    await writeFakeDependencyCruiser(root, {
      config: "export default async function extractConfig() { return { forbidden: [{ name: 'no-new-debt', severity: 'ignore' }] }; }\n",
      cruise: "export async function cruise() { throw new Error('cruise must not run'); }\n",
    });

    const result = await run(adapterFor({}), root);

    assert.equal(result.verdict, 'refuse');
    if (result.verdict !== 'refuse') return;
    assert.equal(result.why.code, 'dependency-cruiser-rule-inactive');
    assert.equal(result.why.location?.file, '.dependency-cruiser.mjs');
    assert.match(result.why.detail ?? '', /no-new-debt/u);
    assert.equal(result.scan.inspected, null);
  });
});

test('an allowed boundary disabled by allowedSeverity REFUSES instead of falsely passing', async () => {
  await withWorkspace(async root => {
    await writeFakeDependencyCruiser(root, {
      config: "export default async function extractConfig() { return { allowed: [{ from: {}, to: {} }], allowedSeverity: 'ignore' }; }\n",
      cruise: "export async function cruise() { throw new Error('cruise must not run'); }\n",
    });

    const result = await run(adapterFor({ rules: { boundary: 'not-in-allowed' } }), root);

    assert.equal(result.verdict, 'refuse');
    if (result.verdict !== 'refuse') return;
    assert.equal(result.why.code, 'dependency-cruiser-rule-inactive');
    assert.equal(result.why.location?.file, '.dependency-cruiser.mjs');
    assert.match(result.why.detail ?? '', /not-in-allowed/u);
    assert.equal(result.scan.inspected, null);
  });
});

test('an allowed boundary that is still active is checked, not refused', async () => {
  await withWorkspace(async root => {
    await writeFakeDependencyCruiser(root, {
      config: "export default async function extractConfig() { return { allowed: [{ from: {}, to: {} }] }; }\n",
      cruise: cruiseReporting(`{
    totalCruised: 2,
    violations: [{
      rule: { name: 'not-in-allowed', severity: 'warn' },
      from: 'src/a.ts',
      to: 'src/b.ts',
    }],
  }`),
    });

    const result = await run(adapterFor({ rules: { boundary: 'not-in-allowed' } }), root);

    assert.equal(result.verdict, 'fail', JSON.stringify(result));
    if (result.verdict !== 'fail') return;
    assert.deepEqual(
      result.breaches.map(item => [item.rule, item.location?.file]),
      [['dependency-cruiser/not-in-allowed', 'src/a.ts']],
    );
  });
});

test('a known-violations baseline is forwarded to dependency-cruiser, and new violations still fail', async () => {
  await withWorkspace(async root => {
    await writeFakeDependencyCruiser(root, {
      cruise: cruiseReporting(`{
    totalCruised: 4,
    violations: (options.ignoreKnown === true && options.knownViolations.length === 1)
      ? [
          { rule: { name: 'no-new-debt', severity: 'ignore' }, from: 'src/known.ts', to: 'src/debt.ts' },
          { rule: { name: 'no-new-debt', severity: 'error' }, from: 'src/a.ts', to: 'src/b.ts' },
        ]
      : [{ rule: { name: 'no-new-debt' }, from: 'baseline', to: 'was not forwarded' }],
  }`),
    });
    await writeFile(
      join(root, 'known.json'),
      JSON.stringify([{ rule: { name: 'no-new-debt', severity: 'error' } }]),
      'utf8',
    );

    const result = await run(adapterFor({ knownViolationsFile: 'known.json' }), root);

    assert.equal(result.verdict, 'fail');
    if (result.verdict !== 'fail') return;
    assert.equal(result.breaches.length, 1);
    assert.equal(result.breaches[0]?.location?.file, 'src/a.ts');
  });
});

test('a baseline that is missing or malformed REFUSES rather than quietly guarding nothing', async () => {
  const cases = [
    { name: 'not an array', content: '{ "known": [] }' },
    { name: 'not JSON', content: '{' },
    { name: 'absent', content: null },
  ] as const;

  for (const { name, content } of cases) {
    await withWorkspace(async root => {
      await writeFakeDependencyCruiser(root, {
        cruise: "export async function cruise() { throw new Error('cruise must not run'); }\n",
      });
      if (content !== null) await writeFile(join(root, 'known.json'), content, 'utf8');

      const result = await run(adapterFor({ knownViolationsFile: 'known.json' }), root);

      assert.equal(result.verdict, 'refuse', name);
      if (result.verdict !== 'refuse') return;
      assert.equal(result.why.code, 'dependency-cruiser-known-violations-invalid', name);
      assert.equal(result.why.location?.file, 'known.json');
      assert.equal(result.scan.inspected, null);
    });
  }
});

test('a cruise result Redproof cannot read REFUSES instead of reporting a clean graph', async () => {
  for (const output of ['not json at all', JSON.stringify({ summary: {} }), JSON.stringify({})]) {
    await withWorkspace(async root => {
      await writeFakeDependencyCruiser(root, {
        cruise: `export async function cruise() { return { output: ${JSON.stringify(output)} }; }\n`,
      });

      const result = await run(adapterFor({}), root);

      assert.equal(result.verdict, 'refuse', output);
      if (result.verdict !== 'refuse') return;
      assert.equal(result.why.code, 'dependency-cruiser-output-unreadable');
      assert.equal(result.scan.inspected, null);
    });
  }
});

test('a dependency-cruiser that fails to run REFUSES and carries the reason it gave', async () => {
  await withWorkspace(async root => {
    await writeFakeDependencyCruiser(root, {
      cruise: "export async function cruise() { throw new Error('the graph could not be built'); }\n",
    });

    const result = await run(adapterFor({}), root);

    assert.equal(result.verdict, 'refuse');
    if (result.verdict !== 'refuse') return;
    assert.equal(result.why.code, 'dependency-cruiser-unavailable');
    assert.match(result.why.detail ?? '', /the graph could not be built/u);
  });
});

test('a run leaves the working directory of the test process where it found it', async () => {
  await withWorkspace(async root => {
    await writeFakeDependencyCruiser(root, {
      cruise: "export async function cruise() { throw new Error('anything'); }\n",
    });
    const before = process.cwd();

    await run(adapterFor({}), root);

    assert.equal(process.cwd(), before);
  });
});
