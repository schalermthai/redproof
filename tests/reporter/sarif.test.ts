import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { buildSarif, checkProject } from 'redproof';

test('SARIF maps Redproof Rules to descriptors and Breaches to results', async () => {
  const run = await checkProject(resolve('fixtures/fail-single/redproof.config.ts'));
  const sarif = buildSarif(run) as any;

  assert.equal(sarif.version, '2.1.0');
  assert.equal(sarif.runs[0].tool.driver.name, 'redproof');
  assert.ok(sarif.runs[0].tool.driver.rules.some((rule: any) => rule.id === 'parser/rejects-malformed-input'));

  const result = sarif.runs[0].results[0];
  assert.equal(result.ruleId, 'parser/rejects-malformed-input');
  assert.equal(result.locations[0].physicalLocation.artifactLocation.uri, 'src/parser.ts');
  assert.equal(result.locations[0].physicalLocation.region.startLine, 2);
  assert.equal(result.locations[0].physicalLocation.region.startColumn, 30);
});

test('SARIF maps REFUSE to invocation notification, not a fake Rule result', async () => {
  const run = await checkProject(resolve('fixtures/refuse/redproof.config.ts'));
  const sarif = buildSarif(run) as any;

  assert.deepEqual(sarif.runs[0].results, []);
  assert.equal(sarif.runs[0].invocations[0].executionSuccessful, false);
  assert.match(sarif.runs[0].invocations[0].toolExecutionNotifications[0].message.text, /^eslint:/);
});
