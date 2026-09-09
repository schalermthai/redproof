import assert from 'node:assert/strict';
import test from 'node:test';

import { assessFreshness, type TreeStamp } from '../../packages/redproof/src/workspace/core/freshness.ts';
import { fingerprint, stampRecord, type StampEntry } from '../../packages/redproof/src/workspace/core/stamp.ts';

function stampOf(entry: StampEntry): string {
  return fingerprint(stampRecord(entry));
}

function staleWhy(baseline: TreeStamp, current: TreeStamp): string {
  const freshness = assessFreshness(baseline, current);
  assert.equal(freshness.kind, 'stale');
  if (freshness.kind !== 'stale') throw new Error('expected stale');
  return freshness.why;
}

test('a tree is fresh only when both the digest and the entry count match the baseline', () => {
  const baseline = { digest: 'abcdef', entries: 2 };

  assert.deepEqual(assessFreshness(baseline, { digest: 'abcdef', entries: 2 }), { kind: 'fresh' });
  assert.equal(assessFreshness(baseline, { digest: 'abcdeg', entries: 2 }).kind, 'stale');
  assert.equal(assessFreshness(baseline, { digest: 'abcdef', entries: 3 }).kind, 'stale');
});

test('the stale reason names the first twelve characters of both digests', () => {
  const why = staleWhy(
    { digest: '0123456789abcdef', entries: 1 },
    { digest: 'fedcba9876543210', entries: 1 },
  );

  assert.equal(why, 'workspace changed from 0123456789ab to fedcba987654');
});

test('the stale reason lists added, removed, and modified paths in path order', () => {
  const why = staleWhy(
    { digest: 'before', entries: 3, fingerprints: { 'z-removed.ts': 'old', 'm-modified.ts': 'old', 'same.ts': 'same' } },
    { digest: 'after', entries: 3, fingerprints: { 'a-added.ts': 'new', 'm-modified.ts': 'new', 'same.ts': 'same' } },
  );

  assert.equal(
    why,
    'workspace changed from before to after; changed paths: added a-added.ts, modified m-modified.ts, removed z-removed.ts',
  );
});

test('the stale reason shows at most eight changed paths and counts the rest', () => {
  const fingerprints = Object.fromEntries(
    Array.from({ length: 10 }, (_, index) => [`file-${index}.ts`, 'new']),
  );
  const why = staleWhy(
    { digest: 'before', entries: 0, fingerprints: {} },
    { digest: 'after', entries: 10, fingerprints },
  );

  assert.match(why, /added file-7\.ts, and 2 more$/);
  assert.doesNotMatch(why, /file-8\.ts/);
});

test('exactly eight changed paths are all shown without a remainder', () => {
  const fingerprints = Object.fromEntries(
    Array.from({ length: 8 }, (_, index) => [`file-${index}.ts`, 'new']),
  );
  const why = staleWhy(
    { digest: 'before', entries: 0, fingerprints: {} },
    { digest: 'after', entries: 8, fingerprints },
  );

  assert.match(why, /added file-7\.ts$/);
  assert.doesNotMatch(why, /more/);
});

test('a stamp without fingerprints still goes stale, with no path list', () => {
  const why = staleWhy(
    { digest: 'before', entries: 1 },
    { digest: 'after', entries: 1, fingerprints: { 'a.ts': 'new' } },
  );

  assert.equal(why, 'workspace changed from before to after');
});

test('a file fingerprint changes with its contents, its path, and its permission bits', () => {
  const file: StampEntry = { kind: 'file', path: 'a.txt', mode: 0o100644, contents: Buffer.from('one') };

  assert.equal(stampOf(file), stampOf({ ...file }), 'the same entry always stamps the same');
  assert.notEqual(stampOf(file), stampOf({ ...file, contents: Buffer.from('two') }), 'contents');
  assert.notEqual(stampOf(file), stampOf({ ...file, path: 'b.txt' }), 'path');
  assert.notEqual(stampOf(file), stampOf({ ...file, mode: 0o100755 }), 'permission bits');
});

test('a file fingerprint ignores the type bits of the mode', () => {
  const file: StampEntry = { kind: 'file', path: 'a.txt', mode: 0o100644, contents: Buffer.from('one') };

  assert.equal(stampOf(file), stampOf({ ...file, mode: 0o644 }));
});

test('a link fingerprint changes with its target', () => {
  const link: StampEntry = { kind: 'link', path: 'l', mode: 0o120777, target: 'a.txt' };

  assert.notEqual(stampOf(link), stampOf({ ...link, target: 'b.txt' }));
});

test('a directory, a link, and an empty file at the same path stamp differently', () => {
  const directory = stampOf({ kind: 'directory', path: 'd', mode: 0o755 });
  const link = stampOf({ kind: 'link', path: 'd', mode: 0o755, target: '' });
  const file = stampOf({ kind: 'file', path: 'd', mode: 0o755, contents: Buffer.alloc(0) });

  assert.equal(new Set([directory, link, file]).size, 3);
});
