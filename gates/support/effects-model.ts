import * as ts from 'typescript';

export type SourceInput = {
  readonly file: string;
  readonly content: string;
};

export type EffectFinding = {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly effect: string;
  readonly category: 'import' | 'ambient';
};

export type EffectAnalysis = {
  readonly coreEffectImports: readonly EffectFinding[];
  readonly coreAmbientInputs: readonly EffectFinding[];
  readonly unapprovedBoundaries: readonly EffectFinding[];
};

const CORE_PATH = /^packages\/redproof\/src\/(?:domain|[^/]+\/core)\//;

const EFFECT_MODULE = /^(?:node:)?(?:fs(?:\/promises)?|child_process|os|stream(?:\/.*)?|net|http|https|worker_threads|timers(?:\/promises)?)$/;

const APPROVED_EFFECT_BOUNDARIES = new Set([
  'packages/dependency-cruiser/src/index.ts',
  'packages/eslint/src/index.ts',
  'packages/redproof/src/cli.ts',
  'packages/redproof/src/cli/shell/main.ts',
  'packages/redproof/src/command/shell/check.ts',
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
  'packages/stryker/src/index.ts',
  'packages/testing/src/index.ts',
  'packages/testing/src/runner.ts',
]);

function literalText(node: ts.Expression | undefined): string | undefined {
  return node && ts.isStringLiteralLike(node) ? node.text : undefined;
}

function isPropertyName(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (ts.isPropertyAccessExpression(parent) && parent.name === node)
    || (ts.isPropertyAssignment(parent) && parent.name === node)
    || (ts.isPropertyDeclaration(parent) && parent.name === node)
    || (ts.isPropertySignature(parent) && parent.name === node)
    || (ts.isMethodDeclaration(parent) && parent.name === node);
}

function importedEffect(node: ts.Node): string | undefined {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    const specifier = node.moduleSpecifier;
    if (specifier && ts.isStringLiteralLike(specifier)) {
      if (EFFECT_MODULE.test(specifier.text)) return specifier.text;
      if (/(?:^|\/)helpers\/workspace(?:[.]ts)?$/.test(specifier.text)) {
        return 'temporary workspace helper';
      }
    }
    return undefined;
  }

  if (ts.isImportEqualsDeclaration(node)
      && ts.isExternalModuleReference(node.moduleReference)) {
    const specifier = literalText(node.moduleReference.expression);
    return specifier && EFFECT_MODULE.test(specifier) ? specifier : undefined;
  }

  if (ts.isCallExpression(node)) {
    const dynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
    const requireCall = ts.isIdentifier(node.expression) && node.expression.text === 'require';
    if (dynamicImport || requireCall) {
      const specifier = literalText(node.arguments[0]);
      return specifier && EFFECT_MODULE.test(specifier) ? specifier : undefined;
    }
  }

  return undefined;
}

function ambientEffect(node: ts.Node): string | undefined {
  if (ts.isIdentifier(node) && node.text === 'process' && !isPropertyName(node)) {
    return 'process';
  }

  if (ts.isNewExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'Date'
      && (node.arguments?.length ?? 0) === 0) {
    return 'new Date';
  }

  if (ts.isCallExpression(node)) {
    if (ts.isIdentifier(node.expression)
        && ['setTimeout', 'setInterval', 'setImmediate'].includes(node.expression.text)) {
      return node.expression.text;
    }

    if (ts.isPropertyAccessExpression(node.expression)) {
      const owner = node.expression.expression;
      const member = node.expression.name.text;
      if (ts.isIdentifier(owner) && owner.text === 'Date' && member === 'now') return 'Date.now';
      if (ts.isIdentifier(owner) && owner.text === 'Math' && member === 'random') return 'Math.random';
      if (ts.isIdentifier(owner) && owner.text === 'performance') return `performance.${member}`;
    }
  }

  return undefined;
}

function finding(
  source: ts.SourceFile,
  input: SourceInput,
  node: ts.Node,
  effect: string,
  category: EffectFinding['category'],
): EffectFinding {
  const location = source.getLineAndCharacterOfPosition(node.getStart(source));
  return {
    file: input.file,
    line: location.line + 1,
    column: location.character + 1,
    effect,
    category,
  };
}

function effectsIn(input: SourceInput): EffectFinding[] {
  const source = ts.createSourceFile(
    input.file,
    input.content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const found: EffectFinding[] = [];

  function visit(node: ts.Node): void {
    const imported = importedEffect(node);
    if (imported) found.push(finding(source, input, node, imported, 'import'));

    const ambient = ambientEffect(node);
    if (ambient) found.push(finding(source, input, node, ambient, 'ambient'));

    ts.forEachChild(node, visit);
  }

  visit(source);
  return found;
}

export function analyzeEffects(sources: readonly SourceInput[]): EffectAnalysis {
  const all = sources.flatMap(effectsIn);

  return {
    coreEffectImports: all.filter(item => CORE_PATH.test(item.file) && item.category === 'import'),
    coreAmbientInputs: all.filter(item => CORE_PATH.test(item.file) && item.category === 'ambient'),
    unapprovedBoundaries: all.filter(item =>
      !CORE_PATH.test(item.file) && !APPROVED_EFFECT_BOUNDARIES.has(item.file)
    ),
  };
}

export function analyzePureTestEffects(sources: readonly SourceInput[]): readonly EffectFinding[] {
  return sources.flatMap(effectsIn);
}
