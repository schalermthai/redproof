import assert from 'node:assert/strict';
import test from 'node:test';
import { defineRules, type Rule } from 'redproof';
import {
  violationDiagnostic,
  violationsToBreaches,
  type DependencyCruiserViolation,
} from '../../packages/dependency-cruiser/src/model.ts';

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
