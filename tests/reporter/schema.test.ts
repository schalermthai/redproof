import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { buildJsonCheckReport, buildJsonProveReport } from 'redproof';
import { at, breach, fail, gate, pass, proveRun, refuse, rule, run, unsupported } from './runs.ts';

type Schema = Record<string, any>;

/**
 * Report the ways a value disagrees with the shipped JSON Schema.
 *
 * Only the keywords the two schemas use are interpreted: type, required,
 * properties, additionalProperties, items, const, enum, minimum, and oneOf.
 */
function violations(schema: Schema, value: unknown, path = '$'): string[] {
  const found: string[] = [];

  if (schema.oneOf) {
    const matches = (schema.oneOf as Schema[]).filter(branch => violations(branch, value, path).length === 0);
    if (matches.length !== 1) found.push(`${path} matches ${matches.length} of ${schema.oneOf.length} allowed shapes`);
    return found;
  }

  if ('const' in schema && value !== schema.const) {
    found.push(`${path} is ${JSON.stringify(value)}, not the required ${JSON.stringify(schema.const)}`);
  }
  if (schema.enum && !(schema.enum as unknown[]).includes(value)) {
    found.push(`${path} is ${JSON.stringify(value)}, outside ${JSON.stringify(schema.enum)}`);
  }

  const types: string[] = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
  const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value === 'number'
    ? (Number.isInteger(value) ? 'integer' : 'number')
    : typeof value;
  if (types.length > 0 && !types.includes(actual) && !(actual === 'integer' && types.includes('number'))) {
    found.push(`${path} is a ${actual}, not ${types.join(' or ')}`);
    return found;
  }

  if (typeof schema.minimum === 'number' && typeof value === 'number' && value < schema.minimum) {
    found.push(`${path} is ${value}, below the minimum ${schema.minimum}`);
  }

  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) => found.push(...violations(schema.items, item, `${path}[${index}]`)));
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const key of (schema.required ?? []) as string[]) {
      if (!(key in record)) found.push(`${path}.${key} is required but absent`);
    }
    for (const [key, item] of Object.entries(record)) {
      const child = schema.properties?.[key];
      if (child) found.push(...violations(child, item, `${path}.${key}`));
      else if (schema.additionalProperties === false) found.push(`${path}.${key} is not declared in the schema`);
    }
  }

  return found;
}

const schemaOf = async (name: string): Promise<Schema> =>
  JSON.parse(await readFile(resolve(`packages/redproof/schema/${name}-report-v1.schema.json`), 'utf8'));

const R1 = rule('parser/rejects-malformed-input', 'rejects malformed input');
const R2 = rule('parser/preserves-whitespace', 'preserves whitespace');
const why = { code: 'eslint-config', message: 'ESLint configuration could not be loaded.', location: null };

test('the schema checker itself reports a missing key, a wrong value, and an undeclared key', async () => {
  const schema = await schemaOf('check');
  const report = buildJsonCheckReport(run([gate({ id: 'a', rules: [R1], result: pass() })])) as Record<string, unknown>;

  const { version, ...withoutVersion } = report;
  assert.deepEqual(violations(schema, withoutVersion).filter(item => item.includes('version')), ['$.version is required but absent']);
  assert.deepEqual(violations(schema, { ...report, status: 'ok' }), ['$.status is "ok", outside ["passed","failed","refused"]']);
  assert.deepEqual(violations(schema, { ...report, extra: 1 }), ['$.extra is not declared in the schema']);
});

test('every check report Redproof can produce conforms to the shipped check schema', async () => {
  const schema = await schemaOf('check');
  const reports = [
    run([gate({ id: 'a', rules: [R1, R2], result: pass() })]),
    run([gate({ id: 'a', rules: [R1, R2], result: pass(0) })]),
    run([gate({ id: 'a', rules: [R1, R2], result: fail(
      breach(R1, 'Malformed input was accepted.', at('src/parser.ts', 2, 30), {
        code: 'unexpected-status',
        comparison: { expected: 'invalid', actual: 'valid' },
        detail: 'detail',
        hint: 'hint',
      }),
      breach(R1, 'again', null),
    ) })]),
    run([gate({ id: 'a', rules: [R1, R2], counting: unsupported, result: fail(breach(R1, 'one of many')) })]),
    run([gate({ id: 'a', rules: [R1, R2], result: refuse({ ...why, hint: 'Add a config.' }) })]),
    run([
      gate({ id: 'a', rules: [R1], result: pass() }),
      gate({ id: 'b', rules: [R1, R2], result: fail(breach(R2, 'x')) }),
      gate({ id: 'c', rules: [R1], result: refuse(why) }),
    ]),
  ].map(buildJsonCheckReport);

  for (const report of reports) {
    assert.deepEqual(violations(schema, JSON.parse(JSON.stringify(report))), [], report.status);
  }
});

test('every prove report Redproof can produce conforms to the shipped prove schema', async () => {
  const schema = await schemaOf('prove');
  const report = buildJsonProveReport(proveRun([
    { status: 'completed', gate: 'lint', proof: 'red', expected: 'red', reason: { kind: 'proved', target: 'lint/no-var' }, result: fail(breach('lint/no-var', 'x', at('src/a.mjs', 3))), workerPid: 1 },
    { status: 'completed', gate: 'lint', proof: 'missed', expected: 'red', reason: { kind: 'target-rule-not-breached', target: 'lint/no-var', breached: ['lint/no-let'] }, result: fail(breach('lint/no-let', 'y')), workerPid: 2 },
    { status: 'completed', gate: 'lint', proof: 'green', expected: 'green', reason: { kind: 'verdict-mismatch', expected: 'pass', actual: 'refuse' }, result: refuse(why), workerPid: 3 },
    { status: 'completed', gate: 'lint', proof: 'refuse', expected: 'refuse', reason: { kind: 'proved' }, result: refuse(why), workerPid: 4 },
    { status: 'aborted', gate: 'lint', proof: 'aborted', expected: 'green', error: { code: 'mutation-apply-failed', message: 'm', detail: 'd' }, workerPid: 5 },
    { status: 'unrestored', gate: 'lint', proof: 'unrestored', expected: 'red', error: { code: 'workspace-not-restored', message: 'm' }, result: pass(), workerPid: 6 },
  ], 1));

  assert.deepEqual(violations(schema, JSON.parse(JSON.stringify(report))), []);
  assert.equal(report.proofs.length, 6);
});
