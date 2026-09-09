import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import type { CheckProjectRun } from 'redproof';
import { formatRun, renderCheckReporter, renderProveReporter } from 'redproof';
import { withWorkspace } from '../helpers/workspace.ts';
import { at, breach, fail, gate, pass, proveRun, refuse, rule, run } from './runs.ts';

const R1 = rule('parser/rejects-malformed-input', 'rejects malformed input');
const why = { code: 'eslint-config', message: 'ESLint configuration could not be loaded.', location: null };

const failing = run([gate({ id: 'parser', rules: [R1], result: fail(breach(R1, 'Malformed input was accepted.', at('src/parser.ts', 2, 30))) })]);

test('each reporter name renders the document that name promises', async () => {
  assert.match(await renderCheckReporter('default', failing), /^ ❯ gates\/parser\.ts \(1 rule \| 1 breached \| 1 breach\)/);
  assert.equal(
    await renderCheckReporter('compact', failing),
    'src/parser.ts:2:30: error redproof[parser/rejects-malformed-input]: Malformed input was accepted.',
  );

  const json = JSON.parse(await renderCheckReporter('json', failing));
  assert.equal(json.command, 'check');
  assert.equal(json.status, 'failed');

  const sarif = JSON.parse(await renderCheckReporter('sarif', failing));
  assert.equal(sarif.version, '2.1.0');
  assert.equal(sarif.runs[0].results[0].ruleId, R1.id);
});

test('the default reporter honours the options the CLI passes through', async () => {
  const quiet = run([
    gate({ id: 'a', rules: [R1], result: pass() }),
    gate({ id: 'b', rules: [R1], result: pass() }),
  ]);

  assert.doesNotMatch(await renderCheckReporter('default', quiet), /✓ rejects-malformed-input/);
  assert.match(await renderCheckReporter('default', quiet, { verbose: true }), /✓ rejects-malformed-input/);
  assert.doesNotMatch(await renderCheckReporter('default', quiet), /\[/);
  assert.match(await renderCheckReporter('default', quiet, { color: true }), /\[32m✓\[0m/);
});

test('the prove reporters render either the proof lines or the JSON report', () => {
  const proofs = proveRun([
    { status: 'completed', gate: 'lint', proof: 'a var is flagged', expected: 'green', reason: { kind: 'proved' }, result: pass(), workerPid: 1 },
    { status: 'completed', gate: 'lint', proof: 'a var is missed', expected: 'red', reason: { kind: 'verdict-mismatch', expected: 'fail', actual: 'pass' }, result: pass(), workerPid: 2 },
  ], 1);

  assert.equal(
    renderProveReporter('default', proofs),
    '✓ lint / a var is flagged expected=green actual=pass\n'
    + '✗ lint / a var is missed expected=red actual=pass\n'
    + '    expected fail, got pass; the mutation did not reach what the Rule guards',
  );

  const json = JSON.parse(renderProveReporter('json', proofs));
  assert.equal(json.command, 'prove');
  assert.deepEqual(json.proofs.map((item: { status: string }) => item.status), ['proved', 'not-proved']);
});

function rooted(root: string, result: Parameters<typeof gate>[0]['result'], id = 'parser'): CheckProjectRun {
  const only = gate({ id, rules: [R1], result, file: join(root, `gates/${id}.ts`) });
  return { ...run([only]), project: { root, refusalExit: 2, execution: { mode: 'in-place' }, modules: [only.module] } };
}

const located = () => fail(breach(R1, 'Malformed input was accepted.', at('src/parser.ts', 2, 30)));

test('the terminal report reads the source a Breach points into, resolved from the project root', async () => {
  await withWorkspace(async root => {
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src/parser.ts'), 'export function parse(input) {\n  return { ok: true, value: input };\n}\n', 'utf8');

    const output = await formatRun(rooted(root, located()));
    assert.match(output, / ❯ src\/parser\.ts:2:30\n\n     1\| export function parse\(input\) \{\n     2\|   return \{ ok: true, value: input \};\n      \|                              \^\n     3\| \}\n/);
  });
});

test('a source file that cannot be read costs the excerpt, never the report', async () => {
  await withWorkspace(async root => {
    const output = await formatRun(rooted(root, located()));

    assert.match(output, / ❯ src\/parser\.ts:2:30\n\n   Malformed input was accepted\./);
    assert.doesNotMatch(output, /\n\s+\d+\| /);
    assert.match(output, /\n Gates      1 failed \(1\)\n/);
  });
});

test('a refusal that names no file asks for no source at all', async () => {
  await withWorkspace(async root => {
    const output = await formatRun(rooted(root, refuse(why), 'eslint'));

    assert.match(output, / REFUSE  gates\/eslint\.ts\n\n   ESLint configuration could not be loaded\./);
  });
});
