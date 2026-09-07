import { globSync } from 'node:fs';
import { runner, type TestRunner } from '@redproof/testing';
import { node, stripTypes } from '../support/node.ts';

/**
 * Run every matching test file under `node --test`, reporting JUnit XML.
 *
 * The file list depends on the workspace, so the arguments are built per run.
 * `runner.command` exposes that builder as `argsFor`, and the description names
 * the pattern, so neither can drift from what actually runs.
 */
export function nodeTestSuite(options: { readonly files: string }): TestRunner {
  return runner.command({
    command: node,
    description: `run ${options.files} under node --test with a JUnit report`,
    args: ctx => stripTypes(
      '--test',
      '--test-reporter=junit',
      `--test-reporter-destination=${ctx.reportFile}`,
      ...globSync(options.files, { cwd: ctx.root }).sort(),
    ),
  });
}
