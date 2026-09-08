import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export async function teardown() {
  const report = JSON.parse(await readFile('reports/results.json', 'utf8'));
  assert.equal(typeof report.success, 'boolean');
  assert.ok(report.numTotalTests >= 1);
}
