import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSarif, formatSarifRun } from '../../packages/redproof/src/reporter/core/sarif.ts';
import { at, breach, fail, gate, pass, refuse, rule, run } from './runs.ts';

const R1 = rule('parser/rejects-malformed-input', 'rejects malformed input');
const R2 = rule('parser/preserves-whitespace', 'preserves whitespace');

type SarifRun = {
  readonly tool: { readonly driver: { readonly name: string; readonly rules: readonly { id: string; shortDescription: { text: string } }[] } };
  readonly results: readonly {
    ruleId: string;
    level: string;
    message: { text: string };
    locations?: readonly { physicalLocation: { artifactLocation: { uri: string }; region?: { startLine?: number; startColumn?: number } } }[];
    properties: Record<string, unknown>;
  }[];
  readonly invocations: readonly {
    executionSuccessful: boolean;
    toolExecutionNotifications?: readonly { level: string; message: { text: string }; locations?: readonly unknown[]; properties: Record<string, unknown> }[];
  }[];
};

function sarif(...gates: Parameters<typeof run>[0]): SarifRun {
  const document = buildSarif(run(gates)) as { version: string; $schema: string; runs: readonly SarifRun[] };
  assert.equal(document.version, '2.1.0');
  assert.equal(document.$schema, 'https://json.schemastore.org/sarif-2.1.0.json');
  return document.runs[0]!;
}

test('every Rule of the run becomes one tool descriptor, named once', () => {
  const first = gate({ id: 'a', rules: [R1, R2], result: pass() });
  const second = gate({ id: 'b', rules: [R1], result: fail(breach(R1, 'x')) });

  const driver = sarif(first, second).tool.driver;
  assert.equal(driver.name, 'redproof');
  assert.deepEqual(driver.rules, [
    { id: R1.id, shortDescription: { text: 'rejects malformed input' } },
    { id: R2.id, shortDescription: { text: 'preserves whitespace' } },
  ]);
});

test('a Breach becomes an error result that points at its Rule, its source, and its diagnostic', () => {
  const malformed = breach(R1, 'Malformed input was accepted.', at('src\\parser.ts', 2, 30), {
    code: 'unexpected-status',
    comparison: { expected: 'invalid', actual: 'valid' },
    detail: 'The parser returned a value.',
    hint: 'Reject malformed tokens first.',
  });

  const [result, ...rest] = sarif(gate({ id: 'parser', rules: [R1, R2], result: fail(malformed) })).results;
  assert.deepEqual(rest, []);
  assert.deepEqual(result, {
    ruleId: R1.id,
    level: 'error',
    message: { text: 'Malformed input was accepted.' },
    locations: [{
      physicalLocation: {
        artifactLocation: { uri: 'src/parser.ts' },
        region: { startLine: 2, startColumn: 30 },
      },
    }],
    properties: {
      gateId: 'parser',
      diagnosticCode: 'unexpected-status',
      comparison: { expected: 'invalid', actual: 'valid' },
      detail: 'The parser returned a value.',
      hint: 'Reject malformed tokens first.',
    },
  });
});

test('a result reports only the position the Breach actually has', () => {
  const results = sarif(gate({ id: 'parser', rules: [R1], result: fail(
    breach(R1, 'no column', at('src/a.ts', 7)),
    breach(R1, 'no line', at('src/a.ts')),
    breach(R1, 'no location', null),
  ) })).results;

  assert.deepEqual(results.map(item => item.locations?.[0]?.physicalLocation), [
    { artifactLocation: { uri: 'src/a.ts' }, region: { startLine: 7 } },
    { artifactLocation: { uri: 'src/a.ts' } },
    undefined,
  ]);
  assert.equal('locations' in results[2]!, false);
});

test('a REFUSE becomes an invocation notification and never a Rule result', () => {
  const why = { code: 'eslint-config', message: 'ESLint configuration could not be loaded.', location: at('.eslintrc.json', 3, 1), detail: 'JSON parse error', hint: 'Fix the config.' };
  const document = sarif(gate({ id: 'eslint', rules: [R1, R2], result: refuse(why) }));

  assert.deepEqual(document.results, []);
  assert.equal(document.invocations[0]?.executionSuccessful, false);
  assert.deepEqual(document.invocations[0]?.toolExecutionNotifications, [{
    level: 'error',
    message: { text: 'eslint: ESLint configuration could not be loaded.' },
    locations: [{
      physicalLocation: {
        artifactLocation: { uri: '.eslintrc.json' },
        region: { startLine: 3, startColumn: 1 },
      },
    }],
    properties: {
      gateId: 'eslint',
      diagnosticCode: 'eslint-config',
      detail: 'JSON parse error',
      hint: 'Fix the config.',
    },
  }]);
  assert.deepEqual(document.tool.driver.rules.map(item => item.id), [R1.id, R2.id]);
});

test('a run without a refusal is a successful invocation carrying no notifications', () => {
  const failing = sarif(gate({ id: 'parser', rules: [R1], result: fail(breach(R1, 'x')) })).invocations[0]!;

  assert.equal(failing.executionSuccessful, true);
  assert.equal('toolExecutionNotifications' in failing, false);
});

test('the formatted document is the SARIF object, indented by default and compact on request', () => {
  const source = run([gate({ id: 'parser', rules: [R1], result: fail(breach(R1, 'x', at('src/a.ts', 1, 1))) })]);
  const document = buildSarif(source);

  const pretty = formatSarifRun(source);
  assert.deepEqual(JSON.parse(pretty), document);
  assert.match(pretty, /^\{\n  "\$schema": /);

  const compact = formatSarifRun(source, { pretty: false });
  assert.deepEqual(JSON.parse(compact), document);
  assert.equal(compact.includes('\n'), false);
});
