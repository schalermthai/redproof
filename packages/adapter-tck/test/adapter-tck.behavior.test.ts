import assert from 'node:assert/strict';
import test from 'node:test';
import {
  counting,
  defineAdapter,
  defineRule,
  result,
  type CheckResult,
} from 'redproof';
import {
  adapterTckCases,
  type AdapterTckCase,
  type AdapterTckContract,
  type AdapterTckSpec,
} from '../src/index.ts';

const rule = defineRule({ id: 'sample/rule', description: 'The sample Rule must hold.' });
const scan = {
  source: 'sample',
  startedAt: '2026-01-01T00:00:00.000Z',
  finishedAt: '2026-01-01T00:00:00.001Z',
  inspected: 1,
} as const;

function sampleAdapter() {
  return defineAdapter({
    kind: 'sample',
    rules: { rule },
    check: {
      description: 'sample Check',
      counting: counting.supported,
      async run() {
        return result.pass(scan);
      },
    },
  });
}

function sampleSpec(overrides: Partial<AdapterTckSpec> = {}): AdapterTckSpec {
  return {
    name: 'sample',
    kind: 'sample',
    construction: {
      valid: sampleAdapter,
      emptyRules: {
        name: 'empty',
        run: () => { throw new Error('empty'); },
        message: /empty/u,
      },
      unknownOption: {
        name: 'unknown',
        run: () => { throw new Error('unknown'); },
        message: /unknown/u,
      },
      invalidValues: [{
        name: 'invalid',
        run: () => { throw new Error('invalid'); },
        message: /invalid/u,
      }],
    },
    unavailable: [{
      name: 'unavailable',
      code: 'sample-unavailable',
      async run() {
        return result.refuse({ ...scan, inspected: null }, {
          code: 'sample-unavailable',
          message: 'sample unavailable',
          location: null,
        });
      },
    }],
    evidence: [{
      rule: rule.id,
      violating: () => ({
        kind: 'translated',
        breaches: [{ rule: rule.id, code: 'sample-breach', message: 'sample breach', location: null }],
      }),
      clean: () => ({ kind: 'translated', breaches: [] }),
      unselected: () => ({ kind: 'translated', breaches: [] }),
    }],
    purity: {
      kind: 'sources',
      files: ['packages/adapter-tck/test/fixtures/pure-model.ts'],
      allowedExternalImports: [],
    },
    capabilities: { kind: 'not-applicable', reason: 'sample has no report format' },
    ...overrides,
  };
}

function oneCase(
  specs: readonly AdapterTckSpec[],
  adapter: string,
  contract: AdapterTckContract,
  name: RegExp,
): AdapterTckCase {
  const found = adapterTckCases(specs).find(item =>
    item.adapter === adapter && item.contract === contract && name.test(item.name)
  );
  assert.ok(found, `missing ${adapter} ${contract} TCK case`);
  return found;
}

function run(item: AdapterTckCase): Promise<void> {
  return Promise.resolve().then(item.run);
}

test('the TCK rejects an invalid Adapter returned by valid construction', async () => {
  const bad = sampleSpec({ kind: 'different' });
  await assert.rejects(
    run(oneCase([bad], 'sample', 'constructor-options', /valid configuration/u)),
    /Expected values to be strictly equal/u,
  );
});

test('the TCK rejects a nonconforming unavailable result', async () => {
  const bad = sampleSpec({
    unavailable: [{
      name: 'unavailable',
      code: 'sample-unavailable',
      async run(): Promise<CheckResult> {
        return result.pass(scan);
      },
    }],
  });

  await assert.rejects(
    run(oneCase([bad], 'sample', 'unavailable-execution', /unavailable/u)),
    /'pass' !== 'refuse'/u,
  );
});

test('the TCK rejects a translator that drops selected violating evidence', async () => {
  const bad = sampleSpec({
    evidence: [{
      rule: rule.id,
      violating: () => ({ kind: 'translated', breaches: [] }),
      clean: () => ({ kind: 'translated', breaches: [] }),
      unselected: () => ({ kind: 'translated', breaches: [] }),
    }],
  });

  await assert.rejects(
    run(oneCase([bad], 'sample', 'structured-evidence', /breaches for selected/u)),
    /must create a Breach/u,
  );
});

test('the TCK rejects duplicate registrations and unknown purity delegates', () => {
  assert.throws(() => adapterTckCases([]), /requires at least one registration/u);
  assert.throws(
    () => adapterTckCases([sampleSpec(), sampleSpec()]),
    /duplicate Adapter TCK registration/u,
  );
  assert.throws(
    () => adapterTckCases([sampleSpec({ purity: { kind: 'delegated', to: 'missing' } })]),
    /delegates purity to an unknown Adapter/u,
  );
});

test('the TCK rejects effects in a declared functional core', async () => {
  const bad = sampleSpec({
    purity: {
      kind: 'sources',
      files: ['packages/adapter-tck/test/fixtures/effectful-model.ts'],
      allowedExternalImports: ['node:fs/promises'],
    },
  });

  await assert.rejects(
    run(oneCase([bad], 'sample', 'pure-model', /effect-free/u)),
    /node:fs\/promises/u,
  );
});

test('a delegated purity contract executes the source profile it names', async () => {
  const source = sampleSpec({
    name: 'source',
    purity: {
      kind: 'sources',
      files: ['packages/adapter-tck/test/fixtures/effectful-model.ts'],
      allowedExternalImports: ['node:fs/promises'],
    },
  });
  const delegate = sampleSpec({ name: 'delegate', purity: { kind: 'delegated', to: 'source' } });

  await assert.rejects(
    run(oneCase([source, delegate], 'delegate', 'pure-model', /inherits/u)),
    /node:fs\/promises/u,
  );
});

test('a not-applicable capability profile requires an explanation', async () => {
  const bad = sampleSpec({ capabilities: { kind: 'not-applicable', reason: '' } });
  await assert.rejects(
    run(oneCase([bad], 'sample', 'report-capabilities', /not applicable/u)),
    /requires a reason/u,
  );
});
