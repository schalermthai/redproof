import assert from 'node:assert/strict';
import test from 'node:test';
import type { Rule } from 'redproof';
import {
  dependencyCruiserRuleAvailability,
  violationDiagnostic,
  violationsToBreaches,
  type DependencyCruiserViolation,
} from '../../packages/dependency-cruiser/src/model.ts';

const domain = {
  id: 'dependency-cruiser/domain-no-infrastructure',
  description: 'Domain must not import infrastructure.',
} as const;
const application = {
  id: 'dependency-cruiser/application-no-adapters',
  description: 'Application must not import adapters.',
} as const;

const byForeignRule = new Map<string, Rule>([
  ['domain-no-infrastructure', domain],
  ['application-no-adapters', application],
]);

const violation = (
  name: string,
  extra: Partial<DependencyCruiserViolation> = {},
): DependencyCruiserViolation => ({
  from: 'src/domain/order.ts',
  to: 'src/infrastructure/database.ts',
  rule: { name, severity: 'error' },
  ...extra,
});

test('rule availability distinguishes active, inactive, and missing configuration', () => {
  assert.deepEqual(
    dependencyCruiserRuleAvailability({
      forbidden: [
        { name: 'active-error', severity: 'error' },
        { name: 'active-warn', severity: 'warn' },
        { name: 'inactive', severity: 'ignore' },
      ],
      required: [{ name: 'active-info', severity: 'info' }],
      allowed: [{ from: {}, to: {} }],
    }, [
      'active-error',
      'active-warn',
      'active-info',
      'not-in-allowed',
      'inactive',
      'absent',
    ]),
    {
      missing: ['absent'],
      inactive: ['inactive'],
    },
  );
});

test('an allowed block disabled by allowedSeverity is inactive, not available', () => {
  const allowed = [{ from: {}, to: {} }];

  assert.deepEqual(
    dependencyCruiserRuleAvailability({ allowed, allowedSeverity: 'ignore' }, ['not-in-allowed']),
    { missing: [], inactive: ['not-in-allowed'] },
  );

  for (const allowedSeverity of ['error', 'warn', 'info', undefined]) {
    assert.deepEqual(
      dependencyCruiserRuleAvailability(
        { allowed, ...(allowedSeverity ? { allowedSeverity } : {}) },
        ['not-in-allowed'],
      ),
      { missing: [], inactive: [] },
      `allowedSeverity ${String(allowedSeverity)}`,
    );
  }

  assert.deepEqual(
    dependencyCruiserRuleAvailability({ allowedSeverity: 'ignore' }, ['not-in-allowed']),
    { missing: ['not-in-allowed'], inactive: [] },
    'no allowed block at all is missing, not inactive',
  );
});

test('each adopted violation becomes a Breach of the Redproof Rule that maps to it', () => {
  const breaches = violationsToBreaches([
    violation('domain-no-infrastructure'),
    violation('application-no-adapters', {
      from: 'src/application/place-order.ts',
      to: 'src/adapters/http.ts',
    }),
  ], byForeignRule);

  assert.deepEqual(breaches.map(item => item.rule), [domain.id, application.id]);
  assert.deepEqual(breaches.map(item => item.location?.file), [
    'src/domain/order.ts',
    'src/application/place-order.ts',
  ]);
  assert.deepEqual(breaches.map(item => item.code), [
    'domain-no-infrastructure',
    'application-no-adapters',
  ]);
});

test('a violation of a rule the Gate did not adopt produces no Breach', () => {
  assert.deepEqual(
    violationsToBreaches([
      violation('no-orphans'),
      violation('not-in-allowed'),
    ], byForeignRule),
    [],
  );

  const mixed = violationsToBreaches([
    violation('no-orphans'),
    violation('domain-no-infrastructure'),
  ], byForeignRule);
  assert.deepEqual(mixed.map(item => item.rule), [domain.id]);
});

test('a known violation softened to ignore does not become a Redproof Breach', () => {
  assert.deepEqual(
    violationsToBreaches([
      violation('domain-no-infrastructure', {
        rule: { name: 'domain-no-infrastructure', severity: 'ignore' },
      }),
    ], byForeignRule),
    [],
  );
});

test('a Breach names the dependency that broke the rule and where it starts', () => {
  const diagnostic = violationDiagnostic(violation('domain-no-infrastructure'));

  assert.equal(
    diagnostic.message,
    'Dependency src/domain/order.ts -> src/infrastructure/database.ts violates dependency-cruiser rule domain-no-infrastructure.',
  );
  assert.deepEqual(diagnostic.location, {
    file: 'src/domain/order.ts',
    line: null,
    column: null,
  });
});

test("dependency-cruiser severity stays in dependency-cruiser and never becomes Redproof's", () => {
  const [breach] = violationsToBreaches(
    [violation('domain-no-infrastructure', { rule: { name: 'domain-no-infrastructure', severity: 'warn' } })],
    byForeignRule,
  );

  assert.equal(breach?.rule, domain.id);
  assert.equal('severity' in (breach ?? {}), false);
});

test('an indirect breach carries the route that produced it', () => {
  assert.equal(
    violationDiagnostic(violation('no-cycles', {
      cycle: ['src/a.ts', 'src/b.ts', 'src/a.ts'],
    })).detail,
    'Cycle: src/a.ts -> src/b.ts -> src/a.ts',
  );

  assert.equal(
    violationDiagnostic(violation('domain-no-infrastructure', {
      via: ['src/domain/order.ts', 'src/shared/log.ts'],
    })).detail,
    'Via: src/domain/order.ts -> src/shared/log.ts',
  );

  assert.equal(
    violationDiagnostic(violation('no-cycles', {
      cycle: ['src/a.ts', 'src/b.ts'],
      via: ['src/a.ts', 'src/c.ts'],
    })).detail,
    'Cycle: src/a.ts -> src/b.ts',
    'a cycle is the more precise route, so it wins over via',
  );
});

test('a structured cycle names its modules instead of stringifying its objects', () => {
  assert.equal(
    violationDiagnostic(violation('no-cycles', {
      cycle: [
        { name: 'src/a.ts', dependencyTypes: ['local', 'import'] },
        { name: 'src/b.ts', dependencyTypes: ['local', 'import'] },
      ],
    })).detail,
    'Cycle: src/a.ts -> src/b.ts',
  );
});

test('a direct breach carries no route detail at all', () => {
  const diagnostic = violationDiagnostic(violation('domain-no-infrastructure'));
  assert.equal('detail' in diagnostic, false);

  const emptyRoutes = violationDiagnostic(violation('domain-no-infrastructure', {
    cycle: [],
    via: [],
  }));
  assert.equal('detail' in emptyRoutes, false);
});
