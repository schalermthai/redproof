import assert from 'node:assert/strict';
import test from 'node:test';
import { pathIsInside, resolvePackageVerificationOptions } from '../../scripts/verify-package-options.ts';

const root = '/workspace/redproof';

test('package verification uses a temporary tarball directory by default', () => {
  assert.deepEqual(resolvePackageVerificationOptions([], root), {});
});

test('package verification resolves a retained tarball directory inside the repository', () => {
  assert.deepEqual(
    resolvePackageVerificationOptions(['--pack-destination', 'artifacts'], root),
    { packDestination: '/workspace/redproof/artifacts' },
  );
});

test('canonical path confinement rejects the repository itself and paths outside it', () => {
  assert.equal(pathIsInside(root, `${root}/artifacts`), true);
  assert.equal(pathIsInside(root, root), false);
  assert.equal(pathIsInside(root, '/workspace/outside'), false);
});

test('package verification rejects unknown, incomplete, repeated, and escaping options', () => {
  assert.throws(() => resolvePackageVerificationOptions(['--other'], root), /Unknown option: --other/);
  assert.throws(() => resolvePackageVerificationOptions(['--pack-destination'], root), /requires a path/);
  assert.throws(
    () => resolvePackageVerificationOptions(['--pack-destination', 'one', '--pack-destination', 'two'], root),
    /may be provided only once/,
  );
  assert.throws(
    () => resolvePackageVerificationOptions(['--pack-destination', '../outside'], root),
    /must stay inside the repository/,
  );
  assert.throws(
    () => resolvePackageVerificationOptions(['--pack-destination', '.'], root),
    /must not be the repository root/,
  );
});
