import assert from 'node:assert/strict';
import { sep } from 'node:path';
import test from 'node:test';
import { knip } from '../src/index.ts';
import { checkResult, evaluateExecution, finalOutcome, knipArguments, withinRoot } from '../src/core/decision.ts';
import { issueTypes, knipBreaches, parseKnipEvidence } from '../src/core/model.ts';
import { knipPackageRootOf, unsupportedVersion } from '../src/core/version.ts';

// Independent expectations: catch accidental public ID changes, not just internal consistency.
const expectedNames = {
  files: 'unused-files', dependencies: 'unused-dependencies', devDependencies: 'unused-dev-dependencies',
  optionalPeerDependencies: 'referenced-optional-peer-dependencies', unlisted: 'undeclared-dependencies',
  binaries: 'undeclared-command-dependencies', unresolved: 'unresolved-imports', exports: 'unused-exports',
  types: 'unused-exported-types', nsExports: 'unreferenced-exports-in-used-namespaces',
  nsTypes: 'unreferenced-types-in-used-namespaces', duplicates: 'duplicate-exports',
  enumMembers: 'unused-exported-enum-members', namespaceMembers: 'unused-exported-namespace-members',
  catalog: 'unused-catalog-entries', catalogReferences: 'unresolved-catalog-references', cycles: 'circular-imports',
} as const;

function report() {
  return {
    version: 1, hasConfigLoadErrors: false, hasBlockingHints: false, hintDetails: [],
    report: Object.fromEntries(issueTypes.map(type => [type, true])),
    counters: { ...Object.fromEntries(issueTypes.map(type => [type, 0])), processed: 3 } as Record<string, number>,
    issues: Object.fromEntries(issueTypes.map(type => [type, [] as unknown[]])),
  };
}

test('clean evidence counts inspected files, not findings', () => {
  assert.equal(parseKnipEvidence(JSON.stringify(report())).inspected, 3);
});

for (const type of issueTypes) test(`translates ${type} only to the selected Rule`, () => {
  const data = report();
  data.counters[type] = 1;
  data.issues[type] = [{ type, file: 'src/orders.ts', symbol: 'unusedReceipt', line: 4, col: 8,
    severity: 'warn', ...(type === 'cycles' || type === 'duplicates'
      ? { symbols: [{ symbol: 'first' }, { symbol: 'second' }] } : {}) }];
  const evidence = parseKnipEvidence(JSON.stringify(data));
  const rule = knip({ rules: { selected: type } }).rules.selected;
  assert.equal(rule.id, `knip/${expectedNames[type]}`);
  assert.ok(rule.description.includes('must'));
  const breaches = knipBreaches(evidence.findings, new Map([[type, rule]]));
  assert.equal(breaches.length, 1);
  assert.equal(breaches[0]?.rule, `knip/${expectedNames[type]}`);
  assert.equal(breaches[0]?.code, type);
  assert.deepEqual(breaches[0]?.location, { file: 'src/orders.ts', line: 4, column: 8 });
  assert.equal(knipBreaches(evidence.findings, new Map()).length, 0);
});

for (const [name, change] of Object.entries({
  'missing categories': (data: ReturnType<typeof report>) => { delete data.report.files; },
  'contradictory totals': (data: ReturnType<typeof report>) => { data.counters.files = 1; },
  'invalid processed count': (data: ReturnType<typeof report>) => { data.counters.processed = -1; },
  'missing config status': (data: ReturnType<typeof report>) => { delete (data as Partial<typeof data>).hasConfigLoadErrors; },
})) test(`rejects ${name}`, () => {
  const data = report(); change(data);
  assert.throws(() => parseKnipEvidence(JSON.stringify(data)));
});

function withFinding(type: typeof issueTypes[number], issue: Record<string, unknown>) {
  const data = report();
  data.counters[type] = 1;
  data.issues[type] = [{ type, file: 'src/orders.ts', symbol: 'unusedReceipt', line: 4, col: 8, ...issue }];
  return JSON.stringify(data);
}

for (const [name, type, issue, message] of [
  ['a relative path that escapes the root', 'exports', { file: '../outside.ts' }, /escapes the Gate root/u],
  ['an absolute finding path', 'exports', { file: '/etc/orders.ts' }, /escapes the Gate root/u],
  ['a severity outside warn and error', 'exports', { severity: 'fatal' }, /Invalid Knip finding severity/u],
  ['a duplicates group with one member', 'duplicates', { symbols: [{ symbol: 'only' }] }, /Incomplete Knip duplicates group/u],
  ['a cycles group with one member', 'cycles', { symbols: [{ symbol: 'only' }] }, /Incomplete Knip cycles group/u],
] as const) test(`rejects ${name}`, () => {
  assert.throws(() => parseKnipEvidence(withFinding(type, issue)), message);
});

test('a parent symbol becomes a Namespace prefix ahead of the member list', () => {
  const evidence = parseKnipEvidence(withFinding('namespaceMembers',
    { parentSymbol: 'Config', symbols: [{ symbol: 'timeout', line: 2, col: 3 }, { symbol: 'retries' }] }));
  assert.deepEqual(evidence.findings[0]?.symbols, ['Namespace: Config', 'timeout:2:3', 'retries']);
  const rule = knip({ rules: { members: 'namespaceMembers' } }).rules.members;
  assert.equal(knipBreaches(evidence.findings, new Map([['namespaceMembers', rule]]))[0]?.detail,
    'Namespace: Config -> timeout:2:3 -> retries');
});

for (const [version, unsupported] of [
  ['5.0.0', true], ['6.34.9', true], ['6.35.0', true], ['6.35.1', false], ['6.35.2', false],
  ['6.36.0', false], ['6.99.99', false], ['7.0.0', true], ['6.35.1-beta.1', true],
] as const) test(`version ${version} is ${unsupported ? 'outside' : 'inside'} the supported range`, () => {
  assert.equal(unsupportedVersion(JSON.stringify({ version })), unsupported ? `Installed: ${version}` : undefined);
});

test('a manifest without a version is reported as unknown', () => {
  assert.equal(unsupportedVersion('{"name":"knip"}'), 'Installed: unknown');
});

test('only a CLI under node_modules/knip names an installed package root', () => {
  const inside = ['app', 'node_modules', 'knip', 'bin', 'knip.js'];
  assert.equal(knipPackageRootOf(inside.join(sep)), inside.slice(0, 3).join(sep));
  assert.equal(knipPackageRootOf(['app', 'knip', 'bin', 'knip.js'].join(sep)), undefined);
  assert.equal(knipPackageRootOf(['app', 'wrapper.mjs'].join(sep)), undefined);
});

test('withinRoot accepts the root and its descendants only', () => {
  const root = ['', 'gate', 'root'].join(sep);
  assert.equal(withinRoot(root, root), true);
  assert.equal(withinRoot(root, [root, 'src', 'a.ts'].join(sep)), true);
  assert.equal(withinRoot(root, `${root}x`), false);
  assert.equal(withinRoot(root, ['', 'gate'].join(sep)), false);
  assert.equal(withinRoot(root, ['', 'other', 'place'].join(sep)), false);
});

test('knipArguments carries every option as its native flag', () => {
  const paths = { cli: 'bin/knip.js', reporter: 'reporter.js', configFile: 'knip.json' };
  assert.deepEqual(knipArguments({ rules: { exports: 'exports' } }, { cli: paths.cli, reporter: paths.reporter }),
    ['bin/knip.js', '--reporter', 'reporter.js', '--no-progress']);
  assert.deepEqual(knipArguments({ rules: { exports: 'exports' }, workspace: 'app', production: true, strict: true,
    includeEntryExports: true, treatConfigHintsAsErrors: true }, paths),
  ['bin/knip.js', '--reporter', 'reporter.js', '--no-progress', '--config', 'knip.json', '--workspace=app',
    '--production', '--strict', '--include-entry-exports', '--treat-config-hints-as-errors']);
});

const selectedExports = new Map([['exports' as const, knip({ rules: { exports: 'exports' } }).rules.exports]]);
const completed = (exitCode: number) => ({ kind: 'completed' as const, exitCode, stdout: '', stderr: 'tool noise' });
const text = (data: unknown) => ({ kind: 'text' as const, text: JSON.stringify(data) });

test('decides config errors, then hints, then inactive rules, then an unexplained exit', () => {
  const base = report();
  const everything = { ...base, hasConfigLoadErrors: true, hasBlockingHints: true, hintDetails: ['ignore: obsolete'],
    report: { ...base.report, exports: false } };
  const decide = (data: unknown) => evaluateExecution(completed(1), text(data), selectedExports);
  const config = decide(everything);
  assert.equal(config.kind === 'refuse' && config.code, 'knip-config-unavailable');
  const hinted = { ...everything, hasConfigLoadErrors: false };
  const hints = decide(hinted);
  assert.deepEqual(hints, { kind: 'refuse', code: 'knip-config-hints',
    message: 'Knip configuration or tag hints require attention.', detail: 'ignore: obsolete' });
  const inactive = decide({ ...hinted, hasBlockingHints: false, hintDetails: [] });
  assert.deepEqual(inactive, { kind: 'refuse', code: 'knip-rule-inactive',
    message: 'Selected Knip categories were not inspected.', detail: 'exports' });
  const unexplained = decide(base);
  assert.equal(unexplained.kind === 'refuse' && unexplained.code, 'knip-unsuccessful');
  assert.equal(unexplained.kind === 'refuse' && unexplained.detail, 'tool noise');
  assert.deepEqual(evaluateExecution(completed(0), text(base), selectedExports), { kind: 'evidence', inspected: 3, breaches: [] });
});

test('an exit code outside 0 and 1 or a refused command is decided before the report', () => {
  const broken = { kind: 'unavailable' as const, error: 'Error: ENOENT' };
  const exit = evaluateExecution(completed(2), broken, selectedExports);
  assert.deepEqual(exit, { kind: 'refuse', code: 'knip-unsuccessful', message: 'Knip exited with code 2.', detail: 'tool noise' });
  const refused = evaluateExecution({ kind: 'refused', code: 'command-timeout', message: 'Timed out.' }, broken, selectedExports);
  assert.deepEqual(refused, { kind: 'refuse', code: 'command-timeout', message: 'Timed out.' });
  const missing = evaluateExecution(completed(0), broken, selectedExports);
  assert.deepEqual(missing, { kind: 'refuse', code: 'knip-report-unavailable',
    message: 'Knip did not produce trustworthy evidence.', detail: 'Error: ENOENT\ntool noise' });
  const malformed = evaluateExecution(completed(0), { kind: 'text', text: '{}' }, selectedExports);
  assert.equal(malformed.kind === 'refuse' && malformed.code, 'knip-report-unavailable');
});

test('a failed cleanup overrides only a clean pass', () => {
  const clean = evaluateExecution(completed(0), text(report()), selectedExports);
  const found = evaluateExecution(completed(1), text(withFinding('exports', {})), selectedExports);
  const refused = evaluateExecution(completed(2), text(report()), selectedExports);
  assert.equal(finalOutcome(clean, undefined), clean);
  assert.equal(finalOutcome(found, 'Error: EACCES'), found);
  assert.equal(finalOutcome(refused, 'Error: EACCES'), refused);
  assert.deepEqual(finalOutcome(clean, 'Error: EACCES'), { kind: 'refuse', code: 'knip-cleanup-unavailable',
    message: 'Could not remove temporary Knip evidence.', detail: 'Error: EACCES' });
});

test('checkResult stamps the scan and keeps refusal detail', () => {
  const timestamps = { startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:00:01.000Z' };
  const passed = checkResult(evaluateExecution(completed(0), text(report()), selectedExports), timestamps);
  assert.deepEqual(passed, { verdict: 'pass', scan: { source: 'knip', ...timestamps, inspected: 3 } });
  const refused = checkResult({ kind: 'refuse', code: 'knip-unavailable', message: 'Down.', detail: 'why' }, timestamps);
  assert.equal(refused.verdict, 'refuse');
  if (refused.verdict === 'refuse') {
    assert.deepEqual(refused.scan, { source: 'knip', ...timestamps, inspected: null });
    assert.deepEqual(refused.why, { code: 'knip-unavailable', message: 'Down.', location: null, detail: 'why' });
  }
});
