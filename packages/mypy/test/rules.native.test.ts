import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { defineGate, runGate } from 'redproof';
import { verifiedCodes } from '../src/core/model.ts';
import { mypy } from '../src/index.ts';
import { nativeTest, pinned, python, withFiles, fixtures } from './support/workspace.ts';

const native = nativeTest(test);

type Case = { readonly code: string; readonly red: Record<string, string>; readonly green: Record<string, string> };
const cases = JSON.parse(readFileSync(`${fixtures}cases.json`, 'utf8')) as readonly Case[];

/** Every rule is proven the way a user meets it: through `runGate` against real mypy, that rule alone, empty configuration. */
const gateFor = (code: string) =>
  defineGate({ id: `mypy-${code}`, adapter: mypy({ rules: { only: code }, python, isolated: true, ...pinned }) });

test('the vocabulary and the proven cases are the same list', () => {
  assert.deepEqual(cases.map(c => c.code).sort(), Object.keys(verifiedCodes).sort());
});

for (const { code, red, green } of cases) {
  native(`mypy/${code}: a minimal violation FAILS naming the rule, the fix PASSES`, async () => {
    const failing = await withFiles(red, root => runGate(gateFor(code), root));
    assert.equal(failing.verdict, 'fail', JSON.stringify(failing));
    if (failing.verdict === 'fail') {
      assert.ok(failing.breaches.length >= 1);
      assert.ok(failing.breaches.every(b => b.rule === `mypy/${code}`), JSON.stringify(failing.breaches));
      assert.ok(failing.breaches.some(b => b.location?.file === 'a.py' && b.location.line !== null));
    }
    const passing = await withFiles(green, root => runGate(gateFor(code), root));
    assert.equal(passing.verdict, 'pass', JSON.stringify(passing));
  });
}
