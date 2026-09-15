import {
  analyzeSourceEffects,
  type SourceEffect,
  type SourceInput,
} from '@redproof/adapter-tck';
import * as ts from 'typescript';

export type EffectFinding = SourceEffect;

export type EffectAnalysis = {
  readonly coreEffectImports: readonly EffectFinding[];
  readonly coreAmbientInputs: readonly EffectFinding[];
  readonly unapprovedBoundaries: readonly EffectFinding[];
};

const CORE_PATH = /^packages\/(?:redproof\/src\/(?:domain|[^/]+\/core)|(?!redproof\/)[^/]+\/src\/core)\//;

const APPROVED_EFFECT_BOUNDARIES = new Set([
  'packages/knip/src/index.ts',
  'packages/knip/src/reporter.ts',
  'packages/adapter-tck/src/index.ts',
  'packages/dependency-cruiser/src/index.ts',
  'packages/dependency-cruiser/src/shell/tool.ts',
  'packages/eslint/src/index.ts',
  'packages/redproof/src/cli.ts',
  'packages/redproof/src/cli/shell/main.ts',
  'packages/redproof/src/command/shell/check.ts',
  'packages/redproof/src/command/shell/process-tree.ts',
  'packages/redproof/src/command/shell/spawn.ts',
  'packages/redproof/src/inspect/shell/files.ts',
  'packages/redproof/src/inspect/shell/search.ts',
  'packages/redproof/src/composition/shell/mutation/context.ts',
  'packages/redproof/src/composition/shell/mutation/filesystem.ts',
  'packages/redproof/src/reporter/shell/sources.ts',
  'packages/redproof/src/project/shell/loader.ts',
  'packages/redproof/src/proof/shell/runner.ts',
  'packages/redproof/src/run/shell/gate-worker.ts',
  'packages/redproof/src/run/shell/project-runner.ts',
  'packages/redproof/src/run/shell/worker-process.ts',
  'packages/redproof/src/workspace/shell/copy.ts',
  'packages/stryker/src/shell/run.ts',
  'packages/testing/src/shell/check.ts',
  'packages/istanbul/src/shell/collect.ts',
  'packages/istanbul/src/shell/nyc.ts',
  'packages/testing/src/shell/command-runner.ts',
  'packages/testing/src/shell/vitest-runner.ts',
]);

export function analyzeEffects(sources: readonly SourceInput[]): EffectAnalysis {
  const all = analyzeSourceEffects(sources);

  return {
    coreEffectImports: all.filter(item => CORE_PATH.test(item.file) && item.category === 'import'),
    coreAmbientInputs: all.filter(item => CORE_PATH.test(item.file) && item.category === 'ambient'),
    unapprovedBoundaries: all.filter(item =>
      !CORE_PATH.test(item.file) && !APPROVED_EFFECT_BOUNDARIES.has(item.file)
    ),
  };
}

const PACKAGE_WORKSPACE_HELPER = /(?:^|\/)support\/workspace(?:[.]ts)?$/;

function packageWorkspaceHelperImports(source: SourceInput): EffectFinding[] {
  const file = ts.createSourceFile(source.file, source.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return file.statements.flatMap(statement => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) return [];
    if (!PACKAGE_WORKSPACE_HELPER.test(statement.moduleSpecifier.text)) return [];
    const { line, character } = file.getLineAndCharacterOfPosition(statement.getStart(file));
    return [{ file: source.file, line: line + 1, column: character + 1, effect: 'temporary workspace helper', category: 'import' as const }];
  });
}

export function analyzePureTestEffects(sources: readonly SourceInput[]): readonly EffectFinding[] {
  return [...analyzeSourceEffects(sources), ...sources.flatMap(packageWorkspaceHelperImports)];
}
