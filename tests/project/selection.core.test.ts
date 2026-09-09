import assert from 'node:assert/strict';
import test from 'node:test';
import type { Gate } from '../../packages/redproof/src/domain/index.ts';
import type { LoadedGateModule, LoadedProject } from '../../packages/redproof/src/project/core/discovery.ts';
import { selectModules, unmatchedMessage } from '../../packages/redproof/src/project/core/selection.ts';

const scan = {
  source: 'unit',
  startedAt: '2026-01-01T00:00:00.000Z',
  finishedAt: '2026-01-01T00:00:01.000Z',
  inspected: 1,
};

function moduleAt(file: string, id: string): LoadedGateModule {
  const gate: Gate<any> = {
    id,
    adapter: {
      kind: 'unit',
      rules: {},
      check: {
        description: 'unit',
        counting: { kind: 'supported' },
        async run() {
          return { verdict: 'pass', scan };
        },
      },
    },
  };
  return { file, gate };
}

const root = '/work/project';
const alpha = moduleAt(`${root}/gates/alpha.ts`, 'alpha');
const beta = moduleAt(`${root}/gates/beta.ts`, 'beta');
const project: LoadedProject = {
  root,
  refusalExit: 2,
  execution: { mode: 'in-place' },
  modules: [alpha, beta],
};

test('no Gate files keeps every discovered Gate', () => {
  assert.deepEqual(selectModules(project, []), { kind: 'selected', modules: [alpha, beta] });
});

test('Gate files select Gates in discovery order, once each, by relative or absolute path', () => {
  const ids = (gateFiles: readonly string[]) => {
    const selection = selectModules(project, gateFiles);
    assert.equal(selection.kind, 'selected', JSON.stringify(selection));
    if (selection.kind !== 'selected') throw new Error('unreachable');
    return selection.modules.map(module => module.gate.id);
  };

  assert.deepEqual(ids(['gates/beta.ts']), ['beta']);
  assert.deepEqual(ids(['gates/beta.ts', 'gates/alpha.ts']), ['alpha', 'beta']);
  assert.deepEqual(ids(['gates/alpha.ts', 'gates/alpha.ts']), ['alpha']);
  assert.deepEqual(ids(['./gates/beta.ts']), ['beta']);
  assert.deepEqual(ids([`${root}/gates/beta.ts`]), ['beta']);
});

test('a Gate file that matches nothing reports the file and its resolved target, never an empty selection', () => {
  assert.deepEqual(selectModules(project, ['gates/alpha.ts', 'gates/missing.ts']), {
    kind: 'unmatched',
    gateFile: 'gates/missing.ts',
    target: `${root}/gates/missing.ts`,
  });
  assert.deepEqual(selectModules(project, ['/elsewhere/gates/alpha.ts']), {
    kind: 'unmatched',
    gateFile: '/elsewhere/gates/alpha.ts',
    target: '/elsewhere/gates/alpha.ts',
  });
});

test('the unmatched message says whether the named file exists', () => {
  assert.equal(
    unmatchedMessage('src/alpha.txt', true),
    'src/alpha.txt is not a discovered Gate. gatesRoot does not match it.',
  );
  assert.equal(unmatchedMessage('gates/missing.ts', false), 'No Gate matched: gates/missing.ts');
});
