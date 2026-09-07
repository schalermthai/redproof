import { globSync } from 'node:fs';
import { runner } from '@redproof/testing';
import { node, stripTypes } from '../support/node.ts';

/** Run every matching test file under `node --test`, reporting JUnit XML. */
export function nodeTestSuite(options: { readonly files: string }) {
  return runner.command({
    command: node,
    description: 'run the complete Node test suite with a structured JUnit report',
    args: ({ root, reportFile }) => stripTypes(
      '--test',
      '--test-reporter=junit',
      `--test-reporter-destination=${reportFile}`,
      ...globSync(options.files, { cwd: root }).sort(),
    ),
  });
}
