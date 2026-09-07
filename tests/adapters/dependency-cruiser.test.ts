import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { dependencyCruiser } from '@redproof/dependency-cruiser';
import { defineRules, type Rule } from 'redproof';
import {
  violationDiagnostic,
  violationsToBreaches,
  type DependencyCruiserViolation,
} from '../../packages/dependency-cruiser/src/model.ts';
import { withWorkspace } from '../helpers/workspace.ts';

const rules = defineRules({
  domain: {
    id: 'dependency-cruiser/domain-no-infrastructure',
    description: 'Domain must not import infrastructure.',
  },
  application: {
    id: 'dependency-cruiser/application-no-adapters',
    description: 'Application must not import adapters.',
  },
});

const byForeign = new Map<string, Rule>([
  ['domain-no-infrastructure', rules.domain],
  ['application-no-adapters', rules.application],
]);

test('dependency-cruiser maps each selected violation to the exact Redproof Rule', () => {
  const violations: DependencyCruiserViolation[] = [
    {
      from: 'src/domain/order.ts',
      to: 'src/infrastructure/database.ts',
      rule: { name: 'domain-no-infrastructure', severity: 'error' },
    },
    {
      from: 'src/application/place-order.ts',
      to: 'src/adapters/http.ts',
      rule: { name: 'application-no-adapters', severity: 'warn' },
    },
  ];

  const breaches = violationsToBreaches(violations, byForeign);
  assert.deepEqual(breaches.map(item => item.rule), [
    rules.domain.id,
    rules.application.id,
  ]);
  assert.equal(breaches[0]?.location?.file, 'src/domain/order.ts');
  assert.equal('severity' in (breaches[1] ?? {}), false, 'foreign severity must not leak into Breach');
});

test('dependency-cruiser ignores foreign violations the adapter did not adopt', () => {
  const breaches = violationsToBreaches([
    {
      from: 'src/a.ts',
      to: 'src/b.ts',
      rule: { name: 'some-other-rule' },
    },
  ], byForeign);

  assert.deepEqual(breaches, []);
});

test('dependency-cruiser preserves cycle/via evidence as diagnostic detail', () => {
  assert.equal(
    violationDiagnostic({
      from: 'src/a.ts',
      to: 'src/b.ts',
      rule: { name: 'no-cycle' },
      cycle: ['src/a.ts', 'src/b.ts', 'src/a.ts'],
    }).detail,
    'Cycle: src/a.ts -> src/b.ts -> src/a.ts',
  );
});

test('dependency-cruiser self-hosts with baseline violations and cache disabled', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'src'), { recursive: true });
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
    await writeFile(join(root, 'main.mjs'), `export async function cruise(_files, options) {
  if (options.cache !== false) throw new Error('cache must be disabled');
  if (options.ignoreKnown !== true || options.knownViolations.length !== 1) {
    throw new Error('known violations were not loaded');
  }
  return { output: JSON.stringify({ summary: { totalCruised: 1, violations: [] } }) };
}
`, 'utf8');
    await writeFile(
      join(root, 'config-utl/config.mjs'),
      "export default async function extractConfig() { return { forbidden: [{ name: 'no-new-debt' }] }; }\n",
      'utf8',
    );
    await writeFile(
      join(root, 'config-utl/options.mjs'),
      'export default async function extractOptions() { return { cache: true }; }\n',
      'utf8',
    );
    await writeFile(
      join(root, '.dependency-cruiser.mjs'),
      'export default {};\n',
      'utf8',
    );
    await writeFile(
      join(root, '.dependency-cruiser-known-violations.json'),
      JSON.stringify([{ rule: { name: 'no-new-debt', severity: 'error' } }]),
      'utf8',
    );

    const adapter = dependencyCruiser({
      configFile: '.dependency-cruiser.mjs',
      knownViolationsFile: '.dependency-cruiser-known-violations.json',
      rules: { noNewDebt: 'no-new-debt' },
    });
    const check = await adapter.check.run({
      root,
      rules: [adapter.rules.noNewDebt.id],
    });

    assert.equal(check.verdict, 'pass');
    assert.equal(check.scan.inspected, 1);
  });
});
