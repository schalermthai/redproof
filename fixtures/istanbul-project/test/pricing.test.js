import assert from 'node:assert/strict';
import { discount, shipping } from '../src/pricing.js';

assert.equal(discount(100, true), 90);
assert.equal(discount(100, false), 100);
assert.equal(shipping(60), 0);
assert.equal(shipping(10), 5);
