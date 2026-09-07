import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
  GateSelectionError,
  describeProject,
  loadGateModule,
  loadProject,
  selectGateModules,
} from 'redproof';
import { withWorkspace } from './helpers/workspace.ts';

const configOf = (name: string) => resolve(`fixtures/${name}/redproof.config.ts`);

test('loading a project discovers every Gate under gatesRoot in a stable order', async () => {
  const project = await loadProject(configOf('gate-selection'));

  assert.equal(project.root, resolve('fixtures/gate-selection'));
  assert.deepEqual(project.modules.map(module => module.gate.id), ['alpha', 'beta']);
  assert.deepEqual(
    project.modules.map(module => module.file),
    ['gates/alpha.ts', 'gates/beta.ts'].map(file => resolve(project.root, file)),
  );
});

test('a project that discovers no Gate module is an error, never an empty project', async () => {
  await assert.rejects(
    loadProject(configOf('empty-discovery')),
    /No Gate modules found under .*empty-discovery for "gates\/\*\*\/\*\.ts"\./,
  );
});

test('a Gate module must default-export a Gate', async () => {
  await withWorkspace(async root => {
    const file = join(root, 'no-default.mjs');
    await writeFile(file, 'export const gate = { id: "g" };\n', 'utf8');
    await assert.rejects(loadGateModule(file), /must default-export a Gate/);
  });
});

test('a Gate module may only export proofs for its own Gate', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'gates'));
    const own = join(root, 'gates/own.mjs');
    const other = join(root, 'gates/other.mjs');
    await writeFile(
      own,
      'const gate = { id: "own" };\nexport default gate;\nexport const proofs = { gate, proofs: [] };\n',
      'utf8',
    );
    await writeFile(
      other,
      'const gate = { id: "other" };\nexport default gate;\nexport const proofs = { gate: { id: "other" }, proofs: [] };\n',
      'utf8',
    );

    const loaded = await loadGateModule(own);
    assert.equal(loaded.file, own);
    assert.equal(loaded.proofs?.gate, loaded.gate);
    await assert.rejects(loadGateModule(other), /proofs for a different Gate instance/);
  });
});

test('Gate files select discovered Gates in discovery order, once each, by relative or absolute path', async () => {
  const project = await loadProject(configOf('gate-selection'));
  const ids = (modules: readonly { gate: { id: string } }[]) => modules.map(module => module.gate.id);

  assert.deepEqual(ids(await selectGateModules(project, [])), ['alpha', 'beta']);
  assert.deepEqual(ids(await selectGateModules(project, ['gates/beta.ts'])), ['beta']);
  assert.deepEqual(ids(await selectGateModules(project, ['gates/beta.ts', 'gates/alpha.ts'])), ['alpha', 'beta']);
  assert.deepEqual(ids(await selectGateModules(project, ['gates/alpha.ts', 'gates/alpha.ts'])), ['alpha']);
  assert.deepEqual(ids(await selectGateModules(project, [resolve(project.root, 'gates/beta.ts')])), ['beta']);
});

test('a Gate file that matches no discovered Gate is an error, never an empty run', async () => {
  const project = await loadProject(configOf('gate-selection'));

  await assert.rejects(
    selectGateModules(project, ['gates/alpha.ts', 'gates/missing.ts']),
    (error: unknown) => error instanceof GateSelectionError
      && error.message === 'No Gate matched: gates/missing.ts',
  );
});

test('a real file outside gatesRoot is rejected as not a discovered Gate', async () => {
  const project = await loadProject(configOf('gate-selection'));

  await assert.rejects(
    selectGateModules(project, ['src/alpha.txt']),
    (error: unknown) => error instanceof GateSelectionError
      && error.message === 'src/alpha.txt is not a discovered Gate. gatesRoot does not match it.',
  );
});

test('describe shares the same Gate selection as check and prove', async () => {
  const config = configOf('gate-selection');

  const all = await describeProject(config);
  assert.deepEqual(all.descriptions.map(item => item.gate), ['alpha', 'beta']);

  const one = await describeProject(config, ['gates/beta.ts']);
  assert.deepEqual(one.descriptions.map(item => item.gate), ['beta']);

  await assert.rejects(describeProject(config, ['gates/missing.ts']), GateSelectionError);
});
