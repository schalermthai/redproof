import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { checkProject, formatRun } from 'redproof';

async function renderFixture(name: string): Promise<string> {
  const run = await checkProject(resolve(`fixtures/${name}/redproof.config.ts`));
  return formatRun(run, { color: false });
}

test('many passing Gates stay compact', async () => {
  const output = await renderFixture('pass-multi');
  assert.match(output, /✓ gates\/parser\.ts \(8 rules\)/);
  assert.match(output, /✓ gates\/config\.ts \(5 rules\)/);
  assert.match(output, /✓ gates\/runner\.ts \(12 rules\)/);
  assert.match(output, /Gates\s+3 passed \(3\)/);
  assert.match(output, /Rules\s+25 held \(25\)/);
  assert.doesNotMatch(output, /parser\/1/);
});

test('a single passing Gate expands its Rules', async () => {
  const output = await renderFixture('pass-single');
  assert.match(output, /✓ accepts-valid-input/);
  assert.match(output, /✓ rejects-malformed-input/);
  assert.match(output, /✓ preserves-whitespace/);
  assert.match(output, /Rules\s+3 held \(3\)/);
});

test('a failed Gate expands the breached Rule and renders source evidence', async () => {
  const output = await renderFixture('fail-single');
  assert.match(output, /❯ gates\/parser\.ts \(3 rules \| 1 breached \| 1 breach\)/);
  assert.match(output, /FAIL\s+gates\/parser\.ts > rejects-malformed-input/);
  assert.match(output, /src\/parser\.ts:2:30/);
  assert.match(output, /\^/);
  assert.match(output, /Expected:\s+invalid/);
  assert.match(output, /Received:\s+valid/);
  assert.match(output, /Rules\s+2 held \| 1 breached \(3\)/);
  assert.match(output, /Breaches\s+1/);
});

test('multiple Breaches are grouped under their Rule', async () => {
  const output = await renderFixture('fail-multi-breach');
  assert.match(output, /domain-no-infrastructure\n\s+× 2 breaches/);
  assert.match(output, /application-no-adapters\n\s+× 1 breach/);
  assert.match(output, /FAIL\s+gates\/architecture\.ts > domain-no-infrastructure\n\n2 breaches/);
  assert.match(output, /Rules\s+2 breached \(2\)/);
  assert.match(output, /Breaches\s+3/);
});

test('REFUSE is reported separately from Rule breaches', async () => {
  const output = await renderFixture('refuse');
  assert.match(output, /! gates\/eslint\.ts \(2 rules \| refused\)/);
  assert.match(output, /REFUSE\s+gates\/eslint\.ts/);
  assert.match(output, /Rules\s+2 undecided \(2\)/);
  assert.doesNotMatch(output, /Breaches\s+/);
});

test('unsupported counting never invents exact totals or held Rules', async () => {
  const output = await renderFixture('non-countable');
  assert.match(output, /❯ clean\n\s+× breach detected/);
  assert.match(output, /\? complete \(not established\)/);
  assert.match(output, /Rules\s+1\+ breached \| 1 unknown \(2\)/);
  assert.match(output, /Breaches\s+not countable/);
});

test('mixed project summarizes PASS, FAIL, and REFUSE together', async () => {
  const output = await renderFixture('mixed');
  assert.match(output, /Gates\s+1 passed \| 1 failed \| 1 refused \(3\)/);
  assert.match(output, /Rules\s+4 held \| 1 breached \| 2 undecided \(7\)/);
  assert.match(output, /Breaches\s+2/);
});
