import assert from 'node:assert/strict';
import test from 'node:test';
import { copiesEntry, copyName, stampsEntry } from '../packages/redproof/src/workspace/core/copy-policy.ts';
import { assessFreshness } from '../packages/redproof/src/workspace/core/freshness.ts';
import { fingerprint, stampRecord } from '../packages/redproof/src/workspace/core/stamp.ts';

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

test('a stamp record changes with the kind, the mode, the link target, and the contents', () => {
  const file = { kind: 'file', path: 'a.txt', mode: 0o100644, contents: Buffer.from('one') } as const;
  const record = stampRecord(file);

  assert.deepEqual(record, ['F\u0000a.txt\u0000420\u0000', Buffer.from('one'), '\u0000']);
  assert.notEqual(fingerprint(record), fingerprint(stampRecord({ ...file, mode: 0o100755 })));
  assert.notEqual(fingerprint(record), fingerprint(stampRecord({ ...file, contents: Buffer.from('two') })));
  assert.equal(fingerprint(record), fingerprint(stampRecord({ ...file, mode: 0o644 })), 'only permission bits count');

  const link = { kind: 'link', path: 'l', mode: 0o777, target: 'a.txt' } as const;
  assert.deepEqual(stampRecord(link), ['L\u0000l\u0000511\u0000a.txt\u0000']);
  assert.notEqual(fingerprint(stampRecord(link)), fingerprint(stampRecord({ ...link, target: 'b.txt' })));
  assert.notEqual(
    fingerprint(stampRecord({ kind: 'directory', path: 'd', mode: 0o755 })),
    fingerprint(stampRecord({ kind: 'file', path: 'd', mode: 0o755, contents: Buffer.alloc(0) })),
  );
});

test('the copy policy skips version control and reports everywhere, and dependencies only at the root', () => {
  assert.equal(copiesEntry('.git', true), false);
  assert.equal(copiesEntry('.git', false), false);
  assert.equal(copiesEntry('.redproof', false), false);
  assert.equal(copiesEntry('node_modules', true), false);
  assert.equal(copiesEntry('node_modules', false), true);
  assert.equal(copiesEntry('src', true), true);
  assert.equal(stampsEntry('.redproof', true), false);
  assert.equal(stampsEntry('.redproof', false), true);
  assert.equal(stampsEntry('node_modules', true), true);
  assert.equal(copyName('gates/no todo!'), 'gates-no-todo');
  assert.equal(copyName('!!!'), 'gate');
});
