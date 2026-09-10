import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import test from 'node:test';
import * as ts from 'typescript';
import type { Adapter, Breach, CheckResult, Rule } from 'redproof';
import { analyzeSourceEffects } from './effects.ts';

type MaybePromise<T> = T | Promise<T>;
type NonEmpty<T> = readonly [T, ...T[]];
type AnyAdapter = Adapter<any>;
type AnyBreach = Breach<any>;
type AnyCheckResult = CheckResult<any>;

export type ThrowProbe = {
  readonly name: string;
  readonly run: () => MaybePromise<unknown>;
  readonly message: RegExp;
};

export type RefusalProbe = {
  readonly name: string;
  readonly run: () => Promise<AnyCheckResult>;
  readonly code: string;
};

export type EvidenceObservation =
  | { readonly kind: 'translated'; readonly breaches: readonly AnyBreach[] }
  | { readonly kind: 'checked'; readonly result: AnyCheckResult };

export type EvidenceProbe = {
  readonly rule: string;
  readonly violating: () => MaybePromise<EvidenceObservation>;
  readonly clean: () => MaybePromise<EvidenceObservation>;
  readonly unselected: () => MaybePromise<EvidenceObservation>;
};

export type PurityProfile =
  | {
      readonly kind: 'sources';
      readonly files: NonEmpty<string>;
      readonly allowedExternalImports: readonly string[];
    }
  | { readonly kind: 'delegated'; readonly to: string };

export type CapabilityProfile =
  | { readonly kind: 'not-applicable'; readonly reason: string }
  | {
      readonly kind: 'declared';
      readonly supported: NonEmpty<{
        readonly name: string;
        readonly construct: () => AnyAdapter;
        readonly rules: NonEmpty<string>;
      }>;
      readonly unsupported: readonly ThrowProbe[];
    };

export type AdapterTckSpec = {
  readonly name: string;
  readonly kind: string;
  readonly construction: {
    readonly valid: () => AnyAdapter;
    readonly emptyRules: ThrowProbe;
    readonly unknownOption: ThrowProbe;
    readonly invalidValues: NonEmpty<ThrowProbe>;
  };
  readonly unavailable: NonEmpty<RefusalProbe>;
  readonly evidence: NonEmpty<EvidenceProbe>;
  readonly purity: PurityProfile;
  readonly capabilities: CapabilityProfile;
};

export type AdapterTckContract =
  | 'constructor-options'
  | 'unavailable-execution'
  | 'pure-model'
  | 'report-capabilities'
  | 'structured-evidence';

export type AdapterTckCase = {
  readonly adapter: string;
  readonly contract: AdapterTckContract;
  readonly name: string;
  readonly run: () => MaybePromise<void>;
};

function assertAdapter(adapter: AnyAdapter, spec: AdapterTckSpec): void {
  assert.equal(adapter.kind, spec.kind);
  assert.ok(adapter.check.description.trim(), 'the Check must describe what it runs');
  const rules = Object.values(adapter.rules as Readonly<Record<string, Rule>>);
  assert.ok(rules.length > 0, 'the Adapter must expose at least one Rule');
  assert.equal(new Set(rules.map(rule => rule.id)).size, rules.length, 'Rule ids must be unique');
}

async function expectThrow(probe: ThrowProbe): Promise<void> {
  await assert.rejects(Promise.resolve().then(probe.run), probe.message);
}

function breachesOf(
  observation: EvidenceObservation,
  expected: 'violation' | 'none',
): readonly AnyBreach[] {
  if (observation.kind === 'translated') return observation.breaches;

  if (expected === 'violation') {
    assert.equal(observation.result.verdict, 'fail');
    if (observation.result.verdict !== 'fail') return [];
    return observation.result.breaches;
  }

  assert.equal(observation.result.verdict, 'pass');
  return [];
}

function assertStructuredBreach(breach: AnyBreach, rule: string): void {
  assert.equal(breach.rule, rule);
  assert.ok(breach.code.trim(), 'a Breach must have a diagnostic code');
  assert.ok(breach.message.trim(), 'a Breach must have a diagnostic message');
}

function repositoryPath(file: string, specifier: string): string {
  return normalize(join(dirname(file), specifier)).replaceAll('\\', '/');
}

function validateRegistry(specs: readonly AdapterTckSpec[]): void {
  assert.ok(specs.length > 0, 'Adapter TCK requires at least one registration');
  const names = new Set<string>();
  for (const spec of specs) {
    assert.ok(spec.name.trim(), 'an Adapter TCK registration must have a name');
    assert.ok(spec.kind.trim(), `${spec.name} must declare its Adapter kind`);
    assert.ok(!names.has(spec.name), `duplicate Adapter TCK registration: ${spec.name}`);
    names.add(spec.name);
  }

  for (const spec of specs) {
    if (spec.purity.kind === 'delegated') {
      assert.ok(
        names.has(spec.purity.to),
        `${spec.name} delegates purity to an unknown Adapter: ${spec.purity.to}`,
      );
      assert.notEqual(spec.purity.to, spec.name, `${spec.name} cannot delegate purity to itself`);
    }
  }
}

function sourcePurity(
  spec: AdapterTckSpec,
  specs: readonly AdapterTckSpec[],
  chain: readonly string[] = [],
): Extract<PurityProfile, { readonly kind: 'sources' }> {
  if (spec.purity.kind === 'sources') return spec.purity;

  assert.ok(
    !chain.includes(spec.name),
    `cyclic Adapter purity delegation: ${[...chain, spec.name].join(' -> ')}`,
  );
  const delegation = spec.purity;
  const target = specs.find(candidate => candidate.name === delegation.to);
  assert.ok(target, `${spec.name} delegates purity to an unknown Adapter: ${delegation.to}`);
  return sourcePurity(target, specs, [...chain, spec.name]);
}

function constructorCases(spec: AdapterTckSpec): AdapterTckCase[] {
  const probes = [
    spec.construction.emptyRules,
    spec.construction.unknownOption,
    ...spec.construction.invalidValues,
  ];

  return [
    {
      adapter: spec.name,
      contract: 'constructor-options',
      name: 'accepts a valid configuration',
      run() {
        assertAdapter(spec.construction.valid(), spec);
      },
    },
    ...probes.map((probe): AdapterTckCase => ({
      adapter: spec.name,
      contract: 'constructor-options',
      name: probe.name,
      run: () => expectThrow(probe),
    })),
  ];
}

function unavailableCases(spec: AdapterTckSpec): AdapterTckCase[] {
  return spec.unavailable.map((probe): AdapterTckCase => ({
    adapter: spec.name,
    contract: 'unavailable-execution',
    name: probe.name,
    async run() {
      const result = await probe.run();
      assert.equal(result.verdict, 'refuse');
      if (result.verdict === 'refuse') {
        assert.equal(
          result.scan.inspected,
          null,
          'unavailable execution must not claim inspected evidence',
        );
        assert.equal(result.why.code, probe.code);
      }
    },
  }));
}

function evidenceCases(spec: AdapterTckSpec): AdapterTckCase[] {
  return spec.evidence.flatMap((probe): AdapterTckCase[] => [
    {
      adapter: spec.name,
      contract: 'structured-evidence',
      name: `${probe.rule} breaches for selected structured evidence`,
      async run() {
        const breaches = breachesOf(await probe.violating(), 'violation');
        assert.ok(breaches.length > 0, 'selected violating evidence must create a Breach');
        for (const breach of breaches) assertStructuredBreach(breach, probe.rule);
      },
    },
    {
      adapter: spec.name,
      contract: 'structured-evidence',
      name: `${probe.rule} passes clean structured evidence`,
      async run() {
        assert.deepEqual(breachesOf(await probe.clean(), 'none'), []);
      },
    },
    {
      adapter: spec.name,
      contract: 'structured-evidence',
      name: `${probe.rule} ignores unselected structured evidence`,
      async run() {
        assert.deepEqual(breachesOf(await probe.unselected(), 'none'), []);
      },
    },
  ]);
}

function purityCases(spec: AdapterTckSpec, specs: readonly AdapterTckSpec[]): AdapterTckCase[] {
  const purity = sourcePurity(spec, specs);

  return [{
    adapter: spec.name,
    contract: 'pure-model',
    name: spec.purity.kind === 'delegated'
      ? `inherits the closed, effect-free evidence model declared by ${spec.purity.to}`
      : 'keeps its declared evidence model closed and effect-free',
    async run() {
      const sources = await Promise.all(purity.files.map(async file => ({
        file,
        content: await readFile(file, 'utf8'),
      })));
      assert.deepEqual(analyzeSourceEffects(sources), []);

      const pureFiles = new Set<string>(purity.files);
      const externalImports = new Set(purity.allowedExternalImports);
      for (const source of sources) {
        for (const imported of ts.preProcessFile(source.content).importedFiles) {
          const specifier = imported.fileName;
          if (specifier.startsWith('.')) {
            assert.ok(
              pureFiles.has(repositoryPath(source.file, specifier)),
              `${source.file} reaches ${specifier}, which is outside its declared functional core`,
            );
          } else {
            assert.ok(
              externalImports.has(specifier),
              `${source.file} imports effectful or undeclared package ${specifier}`,
            );
          }
        }
      }
    },
  }];
}

function capabilityCases(spec: AdapterTckSpec): AdapterTckCase[] {
  if (spec.capabilities.kind === 'not-applicable') {
    return [{
      adapter: spec.name,
      contract: 'report-capabilities',
      name: `declares report capabilities not applicable: ${spec.capabilities.reason}`,
      run() {
        assert.ok(spec.capabilities.kind === 'not-applicable');
        assert.ok(spec.capabilities.reason.trim(), 'a not-applicable capability profile requires a reason');
      },
    }];
  }

  return [
    ...spec.capabilities.supported.map((probe): AdapterTckCase => ({
      adapter: spec.name,
      contract: 'report-capabilities',
      name: probe.name,
      run() {
        const adapter = probe.construct();
        assertAdapter(adapter, spec);
        const rules = Object.values(adapter.rules as Readonly<Record<string, Rule>>);
        assert.deepEqual(rules.map(rule => rule.id).sort(), [...probe.rules].sort());
      },
    })),
    ...spec.capabilities.unsupported.map((probe): AdapterTckCase => ({
      adapter: spec.name,
      contract: 'report-capabilities',
      name: probe.name,
      run: () => expectThrow(probe),
    })),
  ];
}

export function adapterTckCases(specs: readonly AdapterTckSpec[]): readonly AdapterTckCase[] {
  validateRegistry(specs);
  return specs.flatMap(spec => [
    ...constructorCases(spec),
    ...unavailableCases(spec),
    ...evidenceCases(spec),
    ...purityCases(spec, specs),
    ...capabilityCases(spec),
  ]);
}

export function runAdapterTck(specs: readonly AdapterTckSpec[]): void {
  for (const item of adapterTckCases(specs)) {
    test(`[${item.contract}] ${item.adapter}: ${item.name}`, item.run);
  }
}

export { analyzeSourceEffects, type SourceEffect, type SourceInput } from './effects.ts';
