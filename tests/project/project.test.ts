import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import {
  GateSelectionError,
  describeProject,
  loadGateModule,
  loadProject,
  selectGateModules,
} from 'redproof';
import { withWorkspace } from '../helpers/workspace.ts';
import { verdictGateModule, writeProject } from './gate-project.ts';

test('loading a project discovers every Gate under gatesRoot in a stable order, relative to the config file', async () => {
  await withWorkspace(async root => {
    const config = await writeProject(root, {
      configFile: 'config/redproof.config.mjs',
      config: { root: '..', gatesRoot: ['gates/**/*.mjs'], refusalExit: 5, execution: { mode: 'copies', maxAtOnce: 2 } },
      files: {
        'gates/beta.mjs': verdictGateModule('beta', 'pass'),
        'gates/alpha.mjs': verdictGateModule('alpha', 'pass'),
        'gates/nested/gamma.mjs': verdictGateModule('gamma', 'pass'),
        'src/not-a-gate.mjs': verdictGateModule('stray', 'pass'),
      },
    });

    const project = await loadProject(config);

    assert.equal(project.root, root);
    assert.equal(project.refusalExit, 5);
    assert.deepEqual(project.execution, { mode: 'copies', maxAtOnce: 2 });
    assert.deepEqual(project.modules.map(module => module.gate.id), ['alpha', 'beta', 'gamma']);
    assert.deepEqual(
      project.modules.map(module => module.file),
      ['gates/alpha.mjs', 'gates/beta.mjs', 'gates/nested/gamma.mjs'].map(file => join(root, file)),
    );
  });
});

test('a project that discovers no Gate module is an error, never an empty project', async () => {
  await withWorkspace(async root => {
    const config = await writeProject(root, { files: { 'src/index.mjs': 'export {};\n' } });

    await assert.rejects(
      loadProject(config),
      /^Error: No Gate modules found under .* for "gates\/\*\*\/\*\.mjs"\.$/,
    );
  });
});

test('a Gate module is read from disk again on every load', async () => {
  await withWorkspace(async root => {
    const file = join(root, 'gate.mjs');

    await writeFile(file, verdictGateModule('first', 'pass'), 'utf8');
    assert.equal((await loadGateModule(file)).gate.id, 'first');

    await writeFile(file, verdictGateModule('second', 'pass'), 'utf8');
    assert.equal((await loadGateModule(file)).gate.id, 'second');
  });
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

test('a Gate file that matches no discovered Gate is a selection error that says whether the file exists', async () => {
  await withWorkspace(async root => {
    const config = await writeProject(root, {
      files: {
        'gates/alpha.mjs': verdictGateModule('alpha', 'pass'),
        'src/alpha.txt': 'not a Gate\n',
      },
    });
    const project = await loadProject(config);

    assert.deepEqual((await selectGateModules(project, ['gates/alpha.mjs'])).map(module => module.gate.id), ['alpha']);

    await assert.rejects(
      selectGateModules(project, ['gates/alpha.mjs', 'gates/missing.mjs']),
      (error: unknown) => error instanceof GateSelectionError
        && error.message === 'No Gate matched: gates/missing.mjs',
    );
    await assert.rejects(
      selectGateModules(project, ['src/alpha.txt']),
      (error: unknown) => error instanceof GateSelectionError
        && error.message === 'src/alpha.txt is not a discovered Gate. gatesRoot does not match it.',
    );
  });
});

test('describe shares the Gate selection with check and prove', async () => {
  await withWorkspace(async root => {
    const config = await writeProject(root, {
      files: {
        'gates/alpha.mjs': verdictGateModule('alpha', 'pass'),
        'gates/beta.mjs': verdictGateModule('beta', 'fail'),
      },
    });

    const all = await describeProject(config);
    assert.deepEqual(all.descriptions.map(item => item.gate), ['alpha', 'beta']);

    const one = await describeProject(config, ['gates/beta.mjs']);
    assert.deepEqual(one.descriptions.map(item => [item.gate, item.check, item.rules.map(rule => rule.id)]), [
      ['beta', 'always fail', ['beta/rule']],
    ]);

    await assert.rejects(describeProject(config, ['gates/missing.mjs']), GateSelectionError);
  });
});
