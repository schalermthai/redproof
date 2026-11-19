import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

// The native tests are only registered when tach is found, so without this a wrong path in CI would stay green.
test('REDPROOF_TACH_REQUIRED turns a missing tach into a failing test for every truthy spelling, and is quiet when not required', () => {
  const run = (env: Record<string, string>) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--experimental-strip-types', '--test', new URL('./native.test.ts', import.meta.url).pathname], {
    encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: undefined, REDPROOF_TACH_REQUIRED: '', REDPROOF_TACH_PYTHON: '/nonexistent/bin/python', ...env },
  }).status;
  for (const spelling of ['1', 'true', 'TRUE', 'yes']) assert.notEqual(run({ REDPROOF_TACH_REQUIRED: spelling }), 0, spelling);
  assert.equal(run({}), 0, 'not required and no tach: nothing registered, nothing fails');
});
