import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import test from 'node:test';
import * as ts from 'typescript';
import { analyzePureTestEffects } from '../../gates/support/effects-model.ts';
import { parseJestJson, parseJunitXml } from '../../packages/testing/src/index.ts';

const pureAdapterSources = [
  'packages/dependency-cruiser/src/model.ts',
  'packages/eslint/src/model.ts',
  'packages/stryker/src/baseline.ts',
  'packages/stryker/src/cwd.ts',
  'packages/stryker/src/model.ts',
  'packages/testing/src/core/paths.ts',
  'packages/testing/src/model.ts',
  'packages/testing/src/reports/jest-json.ts',
  'packages/testing/src/reports/junit-xml.ts',
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
