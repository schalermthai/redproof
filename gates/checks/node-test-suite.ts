import { globSync } from 'node:fs';
import { runner, type TestRunner, type TestRunnerContext } from '@redproof/testing';
import { node, stripTypes } from '../support/node.ts';

/** The Node arguments that run `files` under the test runner, reporting JUnit XML. */
export function nodeTestArgs(files: string, ctx: TestRunnerContext): string[] {
  return stripTypes(
    '--test',
    '--test-reporter=junit',
    `--test-reporter-destination=${ctx.reportFile}`,
    ...globSync(files, { cwd: ctx.root }).sort(),
  );
}

/** Run every matching test file under `node --test`, reporting JUnit XML. */
export function nodeTestSuite(options: { readonly files: string }): TestRunner {
  return runner.command({
    command: node,
    description: 'run the complete Node test suite with a structured JUnit report',
    args: ctx => nodeTestArgs(options.files, ctx),
  });
}
