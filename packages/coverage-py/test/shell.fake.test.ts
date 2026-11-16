import assert from 'node:assert/strict';
import test from 'node:test';
import { chmod, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Adapter } from 'redproof';
import { coveragePy, type CoveragePyCatalog, type CoveragePyRules } from '../src/index.ts';
import { report } from './support/report.ts';
import { withWorkspace } from './support/workspace.ts';

// Shell tier: a fake `python` script stands in for coverage.py, so every refusal path of the shell runs in milliseconds
// without a Python install. The real tool is exercised by native.test.ts.
type Fake = { runExit?: number; jsonExit?: number; report?: string; after?: string; config?: string; probeExit?: number };
async function fakePython(root: string, fake: Fake): Promise<string> {
  const path = join(root, 'fake-python.sh');
  await writeFile(join(root, 'report.fixture'), fake.report ?? '');
  await writeFile(path, `#!/bin/sh
env > '${root}/env.txt'
case "$3" in
  '') touch '${root}/probed'; echo '${fake.config ?? '{"files":[],"omit":[],"exclude":[],"include":[]}'}'; exit ${fake.probeExit ?? 0} ;;
  run) exit ${fake.runExit ?? 0} ;;
  json) prev=; for a in "$@"; do [ "$prev" = "-o" ] && out=$a; prev=$a; done
        pwd > '${root}/cwd.txt'; echo "$out" > '${root}/out.txt'
        [ ${fake.jsonExit ?? 0} -ne 0 ] && { echo "boom" >&2; exit ${fake.jsonExit ?? 0}; }
        cp '${root}/report.fixture' "$out"
        ${fake.after ?? ':'} ;;
esac
`);
  await chmod(path, 0o755);
  return path;
}
async function run(root: string, fake: Fake, options: object = {}, rules: object = { lineCoverage: { minimum: 100 } }) {
  const adapter = coveragePy({ python: await fakePython(root, fake), args: ['run.py'], rules, ...options } as never) as unknown as Adapter<CoveragePyCatalog<Required<CoveragePyRules>>>;
  return adapter.check.run({ root, rules: Object.values(adapter.rules).map(rule => rule.id) });
}
const why = (result: Awaited<ReturnType<typeof run>>) => result.verdict === 'refuse' ? result.why : null;
const clean = report({ 'x.py': { lines: [2, 0] } }), dirty = report({ 'x.py': { lines: [1, 1] } });

test('shell: a good report passes, a below-threshold report fails, through the full shell path', () => withWorkspace(async root => {
  await writeFile(join(root, 'x.py'), 'a = 1\nb = 2\n');
  assert.equal((await run(root, { report: clean })).verdict, 'pass');
  assert.equal((await run(root, { report: dirty })).verdict, 'fail');
}));
test('shell: a failing `coverage json` step REFUSES and names the step', () => withWorkspace(async root => {
  const refusal = why(await run(root, { jsonExit: 3 }));
  assert.equal(refusal?.code, 'coverage-py-producer-unsuccessful');
  assert.match(refusal?.message ?? '', /coverage json/); assert.match(refusal?.detail ?? '', /exit code: 3[\s\S]*boom/);
}));
test('shell: a failing `coverage run` step REFUSES before json is attempted', () => withWorkspace(async root => {
  const refusal = why(await run(root, { runExit: 1, report: clean }));
  assert.match(refusal?.message ?? '', /coverage run/);
  await assert.rejects(readFile(join(root, 'out.txt')), /ENOENT/); // json never ran
}));
for (const [name, fake, options, code, detail] of [
  ['malformed report', { report: '{' }, {}, 'coverage-py-evidence-unavailable', /JSON/],
  ['empty report', { report: '' }, {}, 'coverage-py-evidence-unavailable', /JSON/],
  ['oversize report', { report: clean }, { maxReportBytes: 10 }, 'coverage-py-evidence-unavailable', /bounded regular file/],
  ['report replaced by a symlink', { report: clean, after: 'rm "$out"; ln -s /etc/hosts "$out"' }, {}, 'coverage-py-evidence-unavailable', /bounded regular file/],
  ['unsupported format', { report: clean.replace('"format":3', '"format":2') }, {}, 'coverage-py-evidence-unavailable', /format 2/],
  ['listed file absent on disk', { report: clean }, {}, 'coverage-py-evidence-unavailable', /ENOENT/],
] as const) test(`shell: ${name} REFUSES`, () => withWorkspace(async root => {
  const refusal = why(await run(root, fake, options));
  assert.equal(refusal?.code, code); assert.match(refusal?.detail ?? '', detail);
}));
test('shell: a source symlink that escapes the Gate root REFUSES even though the report path looks inside', () => withWorkspace(async root => {
  await mkdir(join(root, 'inner')); await writeFile(join(root, 'outside.py'), 'a = 1\nb = 2\n');
  await symlink(join(root, 'outside.py'), join(root, 'inner', 'x.py'));
  // Gate root is inner/: x.py resolves, via its link, to a file outside it.
  const result = await (async () => {
    const adapter = coveragePy({ python: await fakePython(root, { report: clean }), args: ['run.py'], rules: { lineCoverage: { minimum: 0 } } });
    return adapter.check.run({ root: join(root, 'inner'), rules: [adapter.rules.lineCoverage.id] });
  })();
  assert.match(why(result)?.detail ?? '', /outside the Gate root/);
}));
test('shell: cleanup failure cannot hide behind a pass, but never masks a fail', () => withWorkspace(async root => {
  await writeFile(join(root, 'x.py'), 'a = 1\nb = 2\n');
  const lock = 'chmod 500 "$(dirname "$out")"';
  try {
    assert.equal(why(await run(root, { report: clean, after: lock }))?.code, 'coverage-py-cleanup-unavailable');
    const stuck = (await readFile(join(root, 'out.txt'), 'utf8')).trim().replace(/\/coverage\.json$/, '');
    await chmod(stuck, 0o700); await rm(stuck, { recursive: true, force: true });
    assert.equal((await run(root, { report: dirty, after: lock })).verdict, 'fail');
  } finally {
    const stuck = (await readFile(join(root, 'out.txt'), 'utf8')).trim().replace(/\/coverage\.json$/, '');
    await chmod(stuck, 0o700).catch(() => undefined); await rm(stuck, { recursive: true, force: true });
  }
}));
test('shell: cwd runs the tool in the subdirectory while paths and expectedFiles stay Gate-root-relative', () => withWorkspace(async root => {
  await mkdir(join(root, 'sub')); await writeFile(join(root, 'sub', 'x.py'), 'a = 1\nb = 2\n');
  const result = await run(root, { report: dirty }, { cwd: 'sub', expectedFiles: ['sub/x.py'] }, { perFileMinimum: { minimum: 100 } });
  assert.equal(result.verdict, 'fail');
  if (result.verdict === 'fail') assert.equal(result.breaches[0]?.location?.file, 'sub/x.py');
  assert.match((await readFile(join(root, 'cwd.txt'), 'utf8')).trim(), /\/sub$/);
}));

test('shell: a project config that omits files or adds exclusions REFUSES; an explicit rcfile accepts it', () => withWorkspace(async root => {
  await writeFile(join(root, 'x.py'), 'a = 1\nb = 2\n'); await writeFile(join(root, 'pyproject.toml'), '');
  const omits = '{"files":["/w/pyproject.toml"],"omit":["src/bad.py"],"exclude":[],"include":[]}';
  const refusal = why(await run(root, { report: clean, config: omits }));
  assert.equal(refusal?.code, 'coverage-py-config-excludes');
  assert.match(refusal?.detail ?? '', /omits src\/bad\.py/); assert.match(refusal?.detail ?? '', /rcfile/);
  assert.match(why(await run(root, { report: clean, config: '{"files":["x"],"omit":[],"exclude":["def g"],"include":[]}' }))?.detail ?? '', /exclusion patterns def g/);
  assert.match(why(await run(root, { report: clean, config: '{"files":["x"],"omit":[],"exclude":[],"include":["a.py"]}' }))?.detail ?? '', /restricts the report to a\.py/);
  assert.equal((await run(root, { report: clean, config: '{"files":["x"],"omit":[],"exclude":[],"include":[]}' })).verdict, 'pass'); // config present, nothing excluded
  await writeFile(join(root, 'project.rc'), '');
  assert.equal((await run(root, { report: clean, config: omits }, { rcfile: 'project.rc' })).verdict, 'pass'); // explicit = acknowledged
}));
test('shell: an explicit rcfile skips the probe; a broken probe fails closed', () => withWorkspace(async root => {
  await writeFile(join(root, 'x.py'), 'a = 1\nb = 2\n'); await writeFile(join(root, 'project.rc'), '');
  await run(root, { report: clean }, { rcfile: 'project.rc' });
  await assert.rejects(readFile(join(root, 'probed')), /ENOENT/);
  assert.equal(why(await run(root, { report: clean, probeExit: 4 }))?.code, 'coverage-py-producer-unsuccessful');
  assert.equal(why(await run(root, { report: clean, config: 'not json' }))?.code, 'coverage-py-evidence-unavailable');
}));
test('shell: ambient config that changes measurement is scrubbed from the child environment, PYTHONPATH is left alone', () => withWorkspace(async root => {
  await writeFile(join(root, 'x.py'), 'a = 1\nb = 2\n');
  const names = ['COVERAGE_RCFILE', 'COVERAGE_FILE', 'COVERAGE_PROCESS_START', 'COVERAGE_DEBUG', 'COVERAGE_DEBUG_FILE', 'PYTHONPATH'];
  const before = Object.fromEntries(names.map(name => [name, process.env[name]]));
  for (const name of names) process.env[name] = '/ambient';
  try { await run(root, { report: clean }); }
  finally { for (const name of names) { if (before[name] === undefined) delete process.env[name]; else process.env[name] = before[name]; } }
  const seen = (await readFile(join(root, 'env.txt'), 'utf8')).split('\n').map(line => line.split('=')[0]);
  for (const name of names.slice(0, 5)) assert.ok(!seen.includes(name), `${name} leaked into the child`);
  assert.ok(seen.includes('PYTHONPATH'));
}));
test('shell: an expected file that is a symlink escaping the Gate root, or does not exist, REFUSES', () => withWorkspace(async root => {
  await mkdir(join(root, 'inner')); await writeFile(join(root, 'outside.py'), 'a = 1\nb = 2\n'); await writeFile(join(root, 'inner', 'x.py'), 'a = 1\nb = 2\n');
  await symlink(join(root, 'outside.py'), join(root, 'inner', 'link.py'));
  const gate = async (expectedFiles: string[]) => {
    const adapter = coveragePy({ python: await fakePython(root, { report: clean }), args: ['run.py'], expectedFiles, rules: { lineCoverage: { minimum: 0 } } });
    return adapter.check.run({ root: join(root, 'inner'), rules: [adapter.rules.lineCoverage.id] });
  };
  assert.match(why(await gate(['link.py']))?.detail ?? '', /expected file link\.py: coverage\.py file is outside the Gate root/);
  assert.match(why(await gate(['ghost.py']))?.detail ?? '', /expected file ghost\.py: ENOENT/);
  assert.equal((await gate(['x.py'])).verdict, 'pass');
}));
test('shell: a report that measures zero statements REFUSES instead of passing every rule vacuously', () => withWorkspace(async root => {
  await writeFile(join(root, 'x.py'), '');
  const refusal = why(await run(root, { report: report({ 'x.py': { lines: [0, 0] } }) }));
  assert.equal(refusal?.code, 'coverage-py-evidence-unavailable'); assert.match(refusal?.detail ?? '', /zero statements/);
}));
