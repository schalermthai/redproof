import assert from 'node:assert/strict';
import test from 'node:test';
import { defineRule } from 'redproof';
import { attribute, messageOf, parseTachReport, type TachRuleKind } from '../src/core/model.ts';
import { readFixture } from './support/workspace.ts';

const rule = (id: string) => defineRule({ id, description: id });
const diagnostics = async (name: string) => {
  const report = parseTachReport(await readFixture(name));
  assert.equal(report.kind, 'diagnostics');
  return report.kind === 'diagnostics' ? report.diagnostics : [];
};

test('parses real captured reports of every diagnostic family', async () => {
  const cases: ReadonlyArray<readonly [string, string, string]> = [
    ['undeclared.report.json', 'UndeclaredDependency', 'Error'],
    ['forbidden.report.json', 'ForbiddenDependency', 'Error'],
    ['deprecated.report.json', 'DeprecatedDependency', 'Warning'],
    ['layer.report.json', 'LayerViolation', 'Error'],
    ['closed-layer.report.json', 'ClosedLayerViolation', 'Error'],
    ['interface.report.json', 'PrivateDependency', 'Error'],
    ['data-type.report.json', 'InvalidDataTypeExport', 'Error'],
    ['unnecessary-ignore.report.json', 'UnusedIgnoreDirective', 'Warning'],
    ['missing-reason.report.json', 'MissingIgnoreDirectiveReason', 'Error'],
  ];
  for (const [file, variant, severity] of cases) {
    const found = await diagnostics(file);
    assert.equal(found.length, 1, file);
    assert.deepEqual({ variant: found[0]?.variant, severity: found[0]?.severity, file: found[0]?.file, line: found[0]?.line },
      { variant, severity, file: 'src/a/__init__.py', line: 1 }, file);
  }
  assert.deepEqual(await diagnostics('ok.report.json'), []);
});

test('the two structural stops are not arrays', async () => {
  assert.deepEqual(parseTachReport(await readFixture('cycle.report.json')), { kind: 'cycle', modules: ['a', 'b'] });
  assert.deepEqual(parseTachReport(await readFixture('visibility.report.json')),
    { kind: 'visibility', errors: [{ dependent: 'a', dependency: 'b', visibility: ['c'] }] });
  assert.deepEqual(parseTachReport('{"error": "boom"}'), { kind: 'error', message: 'boom' });
});

test('configuration diagnostics keep their fields; variants without fields serialise as []', async () => {
  const found = await diagnostics('syntax-error.report.json');
  assert.equal(found[0]?.scope, 'configuration');
  assert.equal(found[0]?.variant, 'SkippedFileSyntaxError');
  assert.equal(found[0]?.fields.file_path, 'a/bad.py');
  assert.deepEqual((await diagnostics('no-python.report.json')).map(d => d.variant), ['ModuleNotFound', 'NoFirstPartyImportsFound']);
});

test('refuses to parse anything that is not a tach report', async () => {
  assert.throws(() => parseTachReport(''));
  assert.throws(() => parseTachReport('Failed to parse project config'));
  assert.throws(() => parseTachReport('{}'), /diagnostics array or an error object/u);
  assert.throws(() => parseTachReport('[{"Located": {}}]'), /severity|file_path/u);
  assert.throws(() => parseTachReport('[{"Nowhere": {}}]'), /Unknown diagnostic scope/u);
});

test("tach's own many_features project: every real diagnostic lands in exactly one selected rule or none", async () => {
  const all = await diagnostics('many-features.report.json');
  const kinds: readonly TachRuleKind[] = ['undeclared-dependency', 'forbidden-dependency', 'layer-violation', 'interface-violation', 'ignore-directive'];
  const selected = new Map(kinds.map(kind => [kind, rule(`tach/${kind}`)] as const));
  const placed = attribute(all, selected, file => file);
  assert.deepEqual(placed.unrecognised, []);
  assert.equal(placed.breaches.length, all.length, 'every diagnostic of this project belongs to a selected kind');
  const counts = Object.fromEntries(kinds.map(kind => [kind, placed.breaches.filter(b => b.rule === `tach/${kind}`).length]));
  assert.deepEqual(counts, { 'undeclared-dependency': 2, 'forbidden-dependency': 1, 'layer-violation': 6, 'interface-violation': 4, 'ignore-directive': 7 });
});

test('an unselected kind is not a breach, and an unknown variant is reported rather than dropped', async () => {
  const [one] = await diagnostics('undeclared.report.json');
  assert.deepEqual(attribute([one!], new Map([['layer-violation' as const, rule('tach/layer-violation')]]), f => f), { breaches: [], unrecognised: [] });
  const stranger = { ...one!, variant: 'BrandNewDiagnostic' };
  assert.deepEqual(attribute([stranger], new Map(), f => f).unrecognised, ['BrandNewDiagnostic']);
});

test('a warning from a selected kind still breaches, and says what tach called it', async () => {
  const [warning] = await diagnostics('deprecated.report.json');
  const { breaches } = attribute([warning!], new Map([['deprecated-dependency' as const, rule('tach/deprecated-dependency')]]), f => f);
  assert.equal(breaches.length, 1);
  assert.match(breaches[0]?.detail ?? '', /Warning/u);
});

test('messages read like tach text output', async () => {
  const [d] = await diagnostics('layer.report.json');
  assert.equal(messageOf(d!), "Cannot use 'b.thing'. Layer 'low' ('a') is lower than layer 'high' ('b').");
});
