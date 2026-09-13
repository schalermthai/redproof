import { isAbsolute, relative } from 'node:path';
import type { Location } from 'redproof';
import type { TestCase, TestRun } from './model.ts';

function normalizeFile(root: string, file: string | null): string | null {
  if (!file) return null;
  if (!isAbsolute(file)) return file.replaceAll('\\', '/');
  const rel = relative(root, file);
  if (!rel.startsWith('..') && !isAbsolute(rel)) return rel.replaceAll('\\', '/');
  return file.replaceAll('\\', '/');
}

function normalizeLocation(root: string, location: Location | null): Location | null {
  if (!location) return null;
  return {
    ...location,
    file: normalizeFile(root, location.file) ?? location.file,
  };
}

/** Report test files relative to the Gate root, with forward slashes. */
export function normalizeRun(root: string, run: TestRun): TestRun {
  return {
    tests: run.tests.map((test): TestCase => ({
      ...test,
      file: normalizeFile(root, test.file),
      location: normalizeLocation(root, test.location),
    })),
  };
}
