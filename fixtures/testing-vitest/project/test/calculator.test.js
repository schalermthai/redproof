import { describe, expect, test } from 'vitest';
import { add } from '../src/calculator.js';

describe('calculator', () => {
  test('adds numbers', () => {
    expect(add(2, 3)).toBe(5);
  });

  // REDPROOF_TODO_SLOT
  // REDPROOF_FLAKY_SLOT
});
