import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defineGate, runGate } from 'redproof';
import { deptry, type DeptryOptions } from '../src/index.ts';
import { deptryBinary, nativeTest as test, pyproject, withProject } from './support/workspace.ts';

type Outcome = readonly string[];

/** Through `runGate`, as a user meets it: the Gate's verdict with only the named rule selected. */
async function judge(root: string, code: string, options: Partial<DeptryOptions> = {}): Promise<Outcome> {
  const verdict = await runGate(defineGate({ id: 'deps', adapter: deptry({ command: deptryBinary, rules: { r: code }, ...options } as never) as never }), root);
  if (verdict.verdict === 'fail') return ['fail', ...verdict.breaches.map(b => `${b.rule}:${b.location?.file}:${b.location?.line ?? '-'}`)];
  return verdict.verdict === 'refuse' ? ['refuse', verdict.why.code] : [verdict.verdict];
}

const CASES: ReadonlyArray<{ code: string; red: Record<string, string>; green: Record<string, string>; breach: string }> = [
  { code: 'DEP001', breach: 'deptry/DEP001:a.py:1',
    red: { 'pyproject.toml': pyproject(), 'a.py': 'import white\n' },
    green: { 'pyproject.toml': pyproject(['white']), 'a.py': 'import white\n' } },
  { code: 'DEP002', breach: 'deptry/DEP002:pyproject.toml:-',
    red: { 'pyproject.toml': pyproject(['requests']), 'a.py': 'print(1)\n' },
    green: { 'pyproject.toml': pyproject(['requests']), 'a.py': 'import requests\n' } },
  { code: 'DEP003', breach: 'deptry/DEP003:a.py:1',
    red: { 'pyproject.toml': pyproject(['deptry']), 'a.py': 'import click\nimport deptry\n' },
    green: { 'pyproject.toml': pyproject(['deptry', 'click']), 'a.py': 'import click\nimport deptry\n' } },
  { code: 'DEP004', breach: 'deptry/DEP004:a.py:1',
    red: { 'pyproject.toml': pyproject([], '[dependency-groups]\ndev = ["black"]\n'), 'a.py': 'import black\n' },
    green: { 'pyproject.toml': pyproject(['black'], '[dependency-groups]\ndev = ["black"]\n'), 'a.py': 'import black\n' } },
  { code: 'DEP005', breach: 'deptry/DEP005:pyproject.toml:-',
    red: { 'pyproject.toml': pyproject(['asyncio']), 'a.py': 'import asyncio\n' },
    green: { 'pyproject.toml': pyproject(), 'a.py': 'import asyncio\n' } },
];

for (const { code, red, green, breach } of CASES) {
  test(`real deptry, ${code} alone: GREEN -> RED -> GREEN`, () => withProject(green, async root => {
    assert.deepEqual(await judge(root, code), ['pass']);
    for (const [name, text] of Object.entries(red)) await writeFile(join(root, name), text);
    assert.deepEqual(await judge(root, code), ['fail', breach]);
    for (const [name, text] of Object.entries(green)) await writeFile(join(root, name), text);
    assert.deepEqual(await judge(root, code), ['pass']);
  }));
}

test('real deptry: a tree that breaks only DEP002 passes the Gate that selects only DEP001', () => withProject(CASES[1]!.red, async root => {
  assert.deepEqual(await judge(root, 'DEP001'), ['pass']);
  assert.deepEqual(await judge(root, 'DEP002'), ['fail', 'deptry/DEP002:pyproject.toml:-']);
}));

test('real deptry: a project `ignore` cannot silence the selected rule', () => withProject({
  'pyproject.toml': pyproject([], '[tool.deptry]\nignore = ["DEP001"]\n'), 'a.py': 'import white\n',
}, async root => {
  assert.deepEqual(await judge(root, 'DEP001'), ['fail', 'deptry/DEP001:a.py:1']);
}));

test('real deptry: per_rule_ignores REFUSE unless accepted, then the ignored module is honoured', () => withProject({
  'pyproject.toml': pyproject([], '[tool.deptry.per_rule_ignores]\nDEP001 = ["white"]\n'), 'a.py': 'import white\n',
}, async root => {
  assert.deepEqual(await judge(root, 'DEP001'), ['refuse', 'deptry-per-rule-ignores']);
  assert.deepEqual(await judge(root, 'DEP001', { allowPerRuleIgnores: true }), ['pass']);
}));

test('real deptry: REFUSE, never PASS, for the ways deptry exits quietly', async () => {
  await withProject({ 'pyproject.toml': pyproject(), 'a.py': 'def (:\n' }, async root => {
    assert.deepEqual(await judge(root, 'DEP001'), ['refuse', 'deptry-input-skipped']);
  });
  await withProject({ 'pyproject.toml': pyproject() }, async root => {
    assert.deepEqual(await judge(root, 'DEP001'), ['refuse', 'deptry-nothing-inspected']);
  });
  await withProject({ 'a.py': 'import white\n' }, async root => {
    assert.deepEqual(await judge(root, 'DEP001'), ['refuse', 'deptry-report-unavailable']);
  });
  await withProject({ 'pyproject.toml': '[[[\n', 'a.py': 'import white\n' }, async root => {
    assert.deepEqual(await judge(root, 'DEP001'), ['refuse', 'deptry-report-unavailable']);
  });
  await withProject({ 'pyproject.toml': pyproject(), 'a.py': 'import white\n' }, async root => {
    assert.deepEqual(await judge(root, 'DEP001', { paths: ['absent'] }), ['refuse', 'deptry-path-missing']);
    assert.deepEqual(await judge(root, 'DEP001', { command: 'redproof-no-such-deptry' }), ['refuse', 'command-unavailable']);
  });
});

test('real deptry: paths, cwd and notebooks are honoured', () => withProject({
  'app/pyproject.toml': pyproject(), 'app/src/a.py': 'import white\n', 'app/src/n.ipynb': JSON.stringify({
    cells: [{ cell_type: 'code', metadata: {}, execution_count: null, outputs: [], source: ['import grey'] }], metadata: {}, nbformat: 4, nbformat_minor: 5,
  }),
}, async root => {
  const outcome = await judge(root, 'DEP001', { cwd: 'app', paths: ['src'] });
  assert.deepEqual(outcome.slice(0, 1), ['fail']);
  assert.deepEqual(outcome.slice(1).sort(), ['deptry/DEP001:app/src/a.py:1', 'deptry/DEP001:app/src/n.ipynb:1']);
  assert.deepEqual(await judge(root, 'DEP001', { cwd: 'app', paths: ['src'], ignoreNotebooks: true }), ['fail', 'deptry/DEP001:app/src/a.py:1']);
}));
