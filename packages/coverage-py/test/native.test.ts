import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineGate, runGate, type Adapter } from 'redproof';
import { coveragePy, type CoveragePyCatalog, type CoveragePyRules } from '../src/index.ts';
import { withWorkspace } from './support/workspace.ts';

// Real coverage.py from the battle-test venv (20-coveragepy/.venv). Skipped when absent.
const python = process.env.REDPROOF_COVERAGE_PY_PYTHON
  ?? fileURLToPath(new URL('../../../../20-coveragepy/.venv/bin/python', import.meta.url));
const real = { skip: existsSync(python) ? false : 'coverage.py venv not found' };

const SOURCE = 'def choose(x):\n    if x:\n        return 1\n    return 2\n';
const BOTH = 'from a import choose\nchoose(True)\nchoose(False)\n';
const ONE = 'from a import choose\nchoose(True)\n';
// The probe rules are chosen per test; typing the catalog as fully selected keeps the assertions readable.
type Full = Adapter<CoveragePyCatalog<Required<CoveragePyRules>>>;
const make = (rules: object, extra: object = {}): Full => coveragePy({ python, args: ['run.py'], source: ['.'], rules, ...extra } as never) as unknown as Full;
async function fixture(root: string, run: string) {
  await writeFile(join(root, 'a.py'), SOURCE); await writeFile(join(root, 'run.py'), run);
}
async function ids(root: string, rules: object, extra?: object) {
  const verdict = await runGate(defineGate({ id: 'cov', adapter: make(rules, extra) as never }), root);
  return verdict.verdict === 'fail' ? ['fail', ...verdict.breaches.map(b => `${b.rule}:${b.code}`)] : [verdict.verdict];
}

test('real coverage.py: branch rule GREEN -> RED -> GREEN', real, () => withWorkspace(async root => {
  await fixture(root, BOTH);
  const rules = { branchCoverage: { minimum: 100 }, lineCoverage: { minimum: 100 } };
  assert.deepEqual(await ids(root, rules), ['pass']);
  await writeFile(join(root, 'run.py'), ONE);
  assert.deepEqual(await ids(root, rules), ['fail', 'coverage-py/line-coverage:line-coverage-below-minimum', 'coverage-py/branch-coverage:branch-coverage-below-minimum']);
  assert.deepEqual(await ids(root, { branchCoverage: { minimum: 100 } }), ['fail', 'coverage-py/branch-coverage:branch-coverage-below-minimum']);
  await writeFile(join(root, 'run.py'), BOTH);
  assert.deepEqual(await ids(root, rules), ['pass']);
}));
test('real coverage.py: an unexecuted file is visible via --source, per-file and no-uncovered-files go RED', real, () => withWorkspace(async root => {
  await fixture(root, BOTH);
  const rules = { perFileMinimum: { minimum: 100 }, noUncoveredFiles: {} };
  assert.deepEqual(await ids(root, rules), ['pass']);
  await writeFile(join(root, 'unrun.py'), 'def never():\n    return 3\n');
  assert.deepEqual(await ids(root, rules), ['fail', 'coverage-py/per-file-minimum:file-below-minimum', 'coverage-py/no-uncovered-files:file-never-executed']);
  // Without --source the unrun file is invisible, so an expected-inventory entry for it must REFUSE by name.
  const blind = make({ lineCoverage: { minimum: 0 } }, { source: undefined, expectedFiles: ['unrun.py'] });
  const refused = await blind.check.run({ root, rules: [blind.rules.lineCoverage.id] });
  assert.equal(refused.verdict, 'refuse');
  if (refused.verdict === 'refuse') assert.equal(refused.why.code, 'coverage-py-incomplete-inventory');
}));
test('real coverage.py: failing program REFUSES (coverage data exists but cannot explain the failure)', real, () => withWorkspace(async root => {
  await fixture(root, 'import sys\nsys.exit(3)\n');
  const adapter = make({ lineCoverage: { minimum: 0 } });
  const result = await adapter.check.run({ root, rules: [adapter.rules.lineCoverage.id] });
  assert.equal(result.verdict, 'refuse');
  if (result.verdict === 'refuse') assert.equal(result.why.code, 'coverage-py-producer-unsuccessful');
}));
test('real coverage.py: rcfile is honoured; missing interpreter REFUSES', real, () => withWorkspace(async root => {
  await fixture(root, BOTH);
  await writeFile(join(root, '.coveragerc'), '[run]\nomit = a.py\n');
  const adapter = make({ noUncoveredFiles: {} , perFileMinimum: { minimum: 100 } }, { rcfile: '.coveragerc' });
  assert.equal((await adapter.check.run({ root, rules: [adapter.rules.noUncoveredFiles.id] })).verdict, 'pass');
  const result = await adapter.check.run({ root, rules: [adapter.rules.perFileMinimum.id] });
  assert.equal(result.verdict, 'pass'); if (result.verdict === 'pass') assert.equal(result.scan.inspected, 1); // a.py omitted by the rcfile
  const missing = coveragePy({ python: join(root, 'no-python'), args: ['run.py'], rules: { lineCoverage: { minimum: 0 } } });
  const refused = await missing.check.run({ root, rules: [missing.rules.lineCoverage.id] });
  assert.equal(refused.verdict, 'refuse'); if (refused.verdict === 'refuse') assert.equal(refused.why.code, 'command-unavailable');
}));
test('real coverage.py: a project fail_under does not turn a written report into a refusal', real, () => withWorkspace(async root => {
  await writeFile(join(root, 'a.py'), SOURCE); await writeFile(join(root, 'run.py'), ONE);
  await writeFile(join(root, '.coveragerc'), '[report]\nfail_under = 100\n');
  // Auto-discovered .coveragerc: coverage is 83 % < 100, yet the verdict must come from Redproof's threshold only.
  assert.deepEqual(await ids(root, { lineCoverage: { minimum: 80 } }), ['pass']);
  assert.deepEqual(await ids(root, { lineCoverage: { minimum: 90 } }), ['fail', 'coverage-py/line-coverage:line-coverage-below-minimum']);
}));
test('real coverage.py: an ambient COVERAGE_RCFILE cannot silently drop files from the verdict', real, () => withWorkspace(async root => {
  await fixture(root, ONE);
  await writeFile(join(root, 'elsewhere.rc'), '[report]\nomit = */a.py\n');
  const before = process.env.COVERAGE_RCFILE;
  process.env.COVERAGE_RCFILE = join(root, 'elsewhere.rc');
  try { assert.deepEqual(await ids(root, { lineCoverage: { minimum: 100 } }), ['fail', 'coverage-py/line-coverage:line-coverage-below-minimum']); }
  finally { if (before === undefined) delete process.env.COVERAGE_RCFILE; else process.env.COVERAGE_RCFILE = before; }
}));
test('real coverage.py: expectedFiles catches a file coverage.py cannot see (unimported namespace-package module)', real, () => withWorkspace(async root => {
  await mkdir(join(root, 'ns')); await writeFile(join(root, 'ns', 'b.py'), 'def b():\n    return 1\n');
  await writeFile(join(root, 'run.py'), 'x = 1\n');
  const blind = make({ lineCoverage: { minimum: 100 } });
  assert.equal((await blind.check.run({ root, rules: [blind.rules.lineCoverage.id] })).verdict, 'pass'); // the hole: 100 % of what it can see
  const guarded = make({ lineCoverage: { minimum: 100 } }, { expectedFiles: ['ns/b.py'] });
  const refused = await guarded.check.run({ root, rules: [guarded.rules.lineCoverage.id] });
  assert.equal(refused.verdict, 'refuse'); if (refused.verdict === 'refuse') assert.equal(refused.why.code, 'coverage-py-incomplete-inventory');
}));
test('real coverage.py: a project file named json.py or coverage.py cannot shadow the tool, and the program still imports its siblings', real, () => withWorkspace(async root => {
  await fixture(root, BOTH);
  await writeFile(join(root, 'json.py'), 'raise SystemExit("shadowed json")');
  await writeFile(join(root, 'coverage.py'), 'raise SystemExit("shadowed coverage")');
  assert.deepEqual(await ids(root, { lineCoverage: { minimum: 0 } }, { source: undefined }), ['pass']);
}));
test('real coverage.py: auto-discovered config that omits files REFUSES; naming it as rcfile accepts it; pragmas alone do not trip it', real, () => withWorkspace(async root => {
  await fixture(root, BOTH); await writeFile(join(root, 'pragmas.py'), 'def f():  # pragma: no cover\n    return 1\n');
  assert.deepEqual(await ids(root, { lineCoverage: { minimum: 0 } }), ['pass']); // default pragma only: not an exclusion beyond defaults
  await writeFile(join(root, 'pyproject.toml'), '[tool.coverage.run]\nomit = ["a.py"]\n');
  const adapter = make({ lineCoverage: { minimum: 0 } });
  const refused = await adapter.check.run({ root, rules: [adapter.rules.lineCoverage.id] });
  assert.equal(refused.verdict, 'refuse'); if (refused.verdict === 'refuse') assert.equal(refused.why.code, 'coverage-py-config-excludes');
  assert.deepEqual(await ids(root, { lineCoverage: { minimum: 0 } }, { rcfile: 'pyproject.toml' }), ['pass']);
  await writeFile(join(root, 'pyproject.toml'), '[tool.coverage.report]\nexclude_also = ["def g"]\n');
  const excl = await adapter.check.run({ root, rules: [adapter.rules.lineCoverage.id] });
  assert.equal(excl.verdict, 'refuse'); if (excl.verdict === 'refuse') assert.match(excl.why.detail ?? '', /exclusion patterns/);
}));
test('real coverage.py: a [report] include or [run] include that narrows the report REFUSES, so an unrun file cannot vanish from the verdict', real, () => withWorkspace(async root => {
  await fixture(root, BOTH); await writeFile(join(root, 'b.py'), 'def b():\n    return 2\n');
  const rules = { lineCoverage: { minimum: 100 }, noUncoveredFiles: {} };
  assert.deepEqual(await ids(root, rules), ['fail', 'coverage-py/line-coverage:line-coverage-below-minimum', 'coverage-py/no-uncovered-files:file-never-executed']);
  for (const section of ['report', 'run']) {
    await writeFile(join(root, '.coveragerc'), `[${section}]\ninclude = a.py\n`);
    const adapter = make(rules);
    const refused = await adapter.check.run({ root, rules: [adapter.rules.lineCoverage.id] });
    assert.equal(refused.verdict, 'refuse', section);
    if (refused.verdict === 'refuse') { assert.equal(refused.why.code, 'coverage-py-config-excludes'); assert.match(refused.why.detail ?? '', /restricts the report to a\.py/); }
  }
  // Acknowledged explicitly, the adapter honours the narrowing the project asked for.
  await writeFile(join(root, '.coveragerc'), '[report]\ninclude = a.py\n');
  assert.deepEqual(await ids(root, { lineCoverage: { minimum: 100 } }, { rcfile: '.coveragerc' }), ['pass']);
}));
