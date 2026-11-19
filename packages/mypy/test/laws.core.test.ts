import assert from 'node:assert/strict';
import test from 'node:test';
import { coversCode, verifiedCodes } from '../src/core/model.ts';

test('law: covering is reflexive, transitive and antisymmetric over every selectable code and sub-code', () => {
  const all = [...Object.keys(verifiedCodes), 'prop-decorator'];
  for (const a of all) {
    assert.ok(coversCode(a, a));
    for (const b of all) {
      if (a !== b && coversCode(a, b)) assert.ok(!coversCode(b, a), `${a} and ${b} cover each other`);
      for (const c of all) if (coversCode(a, b) && coversCode(b, c)) assert.ok(coversCode(a, c), `${a} > ${b} > ${c}`);
    }
  }
});
