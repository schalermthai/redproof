import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const MODEL = fileURLToPath(new URL('../src/core/model.ts', import.meta.url));

test('a pattern with many stars against a path of repeated characters answers at once, under a real timeout (it once took 57 s with eight stars)', () => {
  const script = [
    `import { excludeMatcher } from ${JSON.stringify(MODEL)};`,
    "const path = '/tmp/work/' + 'a'.repeat(40) + '/pkg/mod.py';",
    "const started = performance.now();",
    "const results = [8, 12, 30].map(k => excludeMatcher(['*a'.repeat(k) + '*Z'], false)(path));",
    'console.log(JSON.stringify({ results, ms: performance.now() - started }));',
  ].join('\n');
  // Under the old translation this does not finish: the child is killed by the timeout and `status` is null.
  const run = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--experimental-strip-types', '--input-type=module', '-e', script], { encoding: 'utf8', timeout: 8000 });
  assert.equal(run.status, 0, `the child did not finish (status ${String(run.status)}, signal ${String(run.signal)}): ${run.stderr}`);
  const { results, ms } = JSON.parse(run.stdout) as { results: boolean[]; ms: number };
  assert.deepEqual(results, [false, false, false]);
  assert.ok(ms < 1000, `took ${Math.round(ms)} ms`);
});
