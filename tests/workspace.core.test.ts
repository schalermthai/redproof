import assert from 'node:assert/strict';
import test from 'node:test';
import { assessFreshness } from '../packages/redproof/src/workspace/core/freshness.ts';

test('freshness comparison checks both digest and entry count', () => {
  assert.deepEqual(
    assessFreshness({ digest: 'abcdef', entries: 2 }, { digest: 'abcdef', entries: 2 }),
    { kind: 'fresh' },
  );

  assert.deepEqual(
    assessFreshness({ digest: 'abcdef', entries: 2 }, { digest: 'abcdef', entries: 3 }),
    { kind: 'stale', why: 'workspace changed from abcdef to abcdef' },
  );
});

test('freshness diagnostics identify added, removed, and modified paths', () => {
  const freshness = assessFreshness(
    {
      digest: 'before',
      entries: 2,
      fingerprints: { 'removed.ts': 'old', 'modified.ts': 'old' },
    },
    {
      digest: 'after',
      entries: 2,
      fingerprints: { 'added.ts': 'new', 'modified.ts': 'new' },
    },
  );

  assert.deepEqual(freshness, {
    kind: 'stale',
    why: 'workspace changed from before to after; changed paths: added added.ts, modified modified.ts, removed removed.ts',
  });
});

test('freshness diagnostics show at most eight changed paths and count the rest', () => {
  const fingerprints = Object.fromEntries(
    Array.from({ length: 10 }, (_, index) => [`file-${index}.ts`, 'new']),
  );
  const freshness = assessFreshness(
    { digest: 'before', entries: 0, fingerprints: {} },
    { digest: 'after', entries: 10, fingerprints },
  );

  assert.equal(freshness.kind, 'stale');
  if (freshness.kind !== 'stale') throw new Error('expected stale');
  assert.match(freshness.why, /added file-7\.ts, and 2 more$/);
  assert.doesNotMatch(freshness.why, /file-8\.ts/);
});
