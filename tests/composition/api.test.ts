import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import {
  breach,
  counting,
  defineCheck,
  defineGate,
  defineRules,
  files,
  result,
  text,
  type Scan,
} from 'redproof';
import { withWorkspace } from '../helpers/workspace.ts';

const scan: Scan = {
  source: 'composition-test',
  startedAt: '',
  finishedAt: '',
  inspected: 1,
};

test('defineRules preserves aliases and native defineGate supplies only native adapter plumbing', () => {
  const rules = defineRules({
    noTodo: { id: 'source/no-todo', description: 'No TODO comments.' },
    noFixme: { id: 'source/no-fixme', description: 'No FIXME comments.' },
  });

  const gate = defineGate({
    id: 'source-markers',
    rules,
    check: {
      description: 'check source markers',
      counting: counting.supported,
      async run() { return result.pass(scan); },
    },
  });

  assert.equal(gate.adapter.kind, 'native');
  assert.equal(gate.adapter.rules.noTodo, rules.noTodo);
  assert.equal(gate.adapter.rules.noFixme, rules.noFixme);
});

test('defineCheck binds a reusable Check to an explicit Rule catalog', () => {
  const rules = defineRules({ one: { id: 'reusable/one', description: 'Reusable rule.' } });
  const check = defineCheck(rules, {
    description: 'reusable check',
    counting: counting.supported,
    async run() { return result.pass(scan); },
  });

  const gate = defineGate({ id: 'reusable', rules, check });
  assert.equal(gate.adapter.check, check);
});

test('result.fromBreaches maps zero breaches to PASS and findings to FAIL', () => {
  const rule = { id: 'r1', description: 'R1' } as const;
  assert.equal(result.fromBreaches(scan, []).verdict, 'pass');

  const failed = result.fromBreaches(scan, [
    breach(rule, { code: 'x', message: 'x', location: null }),
  ]);
  assert.equal(failed.verdict, 'fail');
  if (failed.verdict !== 'fail') throw new Error('expected fail');
  assert.equal(failed.breaches[0].rule, 'r1');
});

test('files.find and text.find return relative paths plus exact source locations', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src/a.ts'), 'const a = 1;\n// TODO: a\n', 'utf8');
    await writeFile(join(root, 'src/a.test.ts'), '// TODO: test only\n', 'utf8');
    await writeFile(join(root, 'src/b.ts'), 'const b = 2;\n', 'utf8');

    const foundFiles = await files.find({ root }, {
      include: 'src/**/*.ts',
      exclude: 'src/**/*.test.ts',
    });
    assert.deepEqual(foundFiles, ['src/a.ts', 'src/b.ts']);

    const found = await text.find({ root }, {
      files: { include: 'src/**/*.ts', exclude: 'src/**/*.test.ts' },
      find: 'TODO',
    });
    assert.equal(found.matches.length, 1);
    assert.deepEqual(found.matches[0]?.location, { file: 'src/a.ts', line: 2, column: 4 });
    assert.deepEqual(found.matches[0]?.range, { start: 16, end: 20 });
  });
});
