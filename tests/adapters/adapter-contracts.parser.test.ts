import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import test from 'node:test';
import * as ts from 'typescript';
import { analyzePureTestEffects } from '../../gates/support/effects-model.ts';
import { parseJestJson, parseJunitXml } from '../../packages/testing/src/index.ts';

const pureAdapterSources = [
  'packages/dependency-cruiser/src/core/model.ts',
  'packages/dependency-cruiser/src/core/options.ts',
  'packages/dependency-cruiser/src/core/outcome.ts',
  'packages/eslint/src/core/decide.ts',
  'packages/eslint/src/core/model.ts',
  'packages/eslint/src/core/options.ts',
  'packages/stryker/src/core/baseline.ts',
  'packages/stryker/src/core/model.ts',
  'packages/stryker/src/core/options.ts',
  'packages/stryker/src/core/paths.ts',
  'packages/stryker/src/core/verdict.ts',
  'packages/testing/src/core/check.ts',
  'packages/testing/src/core/command-plan.ts',
  'packages/testing/src/core/model.ts',
  'packages/testing/src/core/normalize.ts',
  'packages/testing/src/core/paths.ts',
  'packages/testing/src/core/reports/jest-json.ts',
  'packages/testing/src/core/reports/junit-xml.ts',
  'packages/testing/src/core/vitest-options.ts',
] as const;

const pureAdapterSourceSet = new Set<string>(pureAdapterSources);
const allowedExternalImports = new Set(['node:path', 'redproof']);

function repositoryPath(file: string, specifier: string): string {
  return normalize(join(dirname(file), specifier)).replaceAll('\\', '/');
}

test('parser: adapter parsers and evidence models form a closed, effect-free core', async () => {
  const sources = await Promise.all(pureAdapterSources.map(async file => ({
    file,
    content: await readFile(file, 'utf8'),
  })));

  assert.deepEqual(
    analyzePureTestEffects(sources),
    [],
    'pure adapter models must not import effects or read ambient process state',
  );

  for (const source of sources) {
    const imports = ts.preProcessFile(source.content).importedFiles.map(item => item.fileName);
    for (const specifier of imports) {
      if (specifier.startsWith('.')) {
        assert.ok(
          pureAdapterSourceSet.has(repositoryPath(source.file, specifier)),
          `${source.file} reaches ${specifier}, which is outside the declared functional core`,
        );
      } else {
        assert.ok(
          allowedExternalImports.has(specifier),
          `${source.file} imports effectful or undeclared package ${specifier}`,
        );
      }
    }
  }
});

test('parser: report parsers reject untrusted structure', () => {
  assert.throws(() => parseJestJson('{}'), /missing testResults/u);
  assert.throws(() => parseJestJson(JSON.stringify({
    testResults: [{ assertionResults: [{ status: 'surprising' }] }],
  })), /Unsupported Jest-compatible test status/u);
  assert.throws(() => parseJunitXml('<not-tests/>'), /missing testsuite/u);
  assert.throws(
    () => parseJunitXml('<testsuite><testcase name="broken"></testsuite>'),
    /could not be parsed/u,
  );
});
