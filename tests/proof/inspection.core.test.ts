import assert from 'node:assert/strict';
import test from 'node:test';
import { applyInspectionPolicy } from '../../packages/redproof/src/proof/core/inspection.ts';
import { failResult, passResult, refuseResult } from './results.ts';

test('a zero-inspected PASS becomes REFUSE unless the Gate explicitly allows it', () => {
  const emptyPass = passResult(0);
  const refused = applyInspectionPolicy(emptyPass, 'refuse');

  assert.equal(refused.verdict, 'refuse');
  if (refused.verdict !== 'refuse') throw new Error('expected a refusal');
  assert.equal(refused.why.code, 'nothing-inspected');
  assert.match(refused.why.hint ?? '', /policies\.emptyEvidence/);
  assert.equal(refused.scan, emptyPass.scan, 'the Check scan stays as evidence');

  assert.equal(applyInspectionPolicy(emptyPass, 'allow'), emptyPass);
});

test('a PASS over a positive or unknown count is evidence under either policy', () => {
  const counted = passResult(3);
  const uncounted = passResult(null);

  assert.equal(applyInspectionPolicy(counted, 'refuse'), counted);
  assert.equal(applyInspectionPolicy(uncounted, 'refuse'), uncounted);
  assert.equal(applyInspectionPolicy(counted, 'allow'), counted);
});

test('FAIL and REFUSE keep their own evidence even when the scan count is zero', () => {
  const emptyFailure = failResult(['r1'], 0);
  const emptyRefusal = refuseResult('unavailable', 0);

  assert.equal(applyInspectionPolicy(emptyFailure, 'refuse'), emptyFailure);
  assert.equal(applyInspectionPolicy(emptyRefusal, 'refuse'), emptyRefusal);
});
