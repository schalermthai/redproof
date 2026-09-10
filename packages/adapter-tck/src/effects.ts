import * as ts from 'typescript';

export type SourceInput = {
  readonly file: string;
  readonly content: string;
};

export type SourceEffect = {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly effect: string;
  readonly category: 'import' | 'ambient';
};

const EFFECT_MODULE = /^(?:node:)?(?:fs(?:\/promises)?|child_process|os|stream(?:\/.*)?|net|http|https|worker_threads|timers(?:\/promises)?)$/;

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

function expressionPath(node: ts.Expression): readonly string[] | undefined {
  if (ts.isIdentifier(node)) return [node.text];
  if (!ts.isPropertyAccessExpression(node)) return undefined;
  const owner = expressionPath(node.expression);
  return owner ? [...owner, node.name.text] : undefined;
}

function globalPath(node: ts.Expression): {
  readonly path: readonly string[];
  readonly qualified: boolean;
} | undefined {
  const path = expressionPath(node);
  if (!path?.length) return undefined;
  const qualified = path[0] === 'globalThis' || path[0] === 'global';
  return { path: qualified ? path.slice(1) : path, qualified };
}

function isConsumedExpression(node: ts.Expression): boolean {
  const parent = node.parent;
  return (ts.isPropertyAccessExpression(parent) && parent.expression === node)
    || (ts.isCallExpression(parent) && parent.expression === node)
    || (ts.isNewExpression(parent) && parent.expression === node);
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

  if (ts.isPropertyAccessExpression(node) && !isConsumedExpression(node)) {
    const expression = globalPath(node);
    if (expression?.qualified && expression.path[0] === 'process') return 'process';
  }

  if (ts.isNewExpression(node) && (node.arguments?.length ?? 0) === 0) {
    const expression = globalPath(node.expression);
    if (expression?.path.length === 1 && expression.path[0] === 'Date') return 'new Date';
  }

  if (ts.isCallExpression(node)) {
    const expression = globalPath(node.expression);
    const path = expression?.path ?? [];
    if (path.length === 1
        && ['fetch', 'setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask'].includes(path[0]!)) {
      return path[0];
    }
    if (expression?.qualified && path[0] === 'process') return 'process';
    if (path.length === 2 && path[0] === 'Date' && path[1] === 'now') return 'Date.now';
    if (path.length === 2 && path[0] === 'Math' && path[1] === 'random') return 'Math.random';
    if (path.length === 2 && path[0] === 'performance') return `performance.${path[1]}`;
    if (path.length === 2
        && path[0] === 'crypto'
        && ['getRandomValues', 'randomUUID'].includes(path[1]!)) {
      return `crypto.${path[1]}`;
    }
  }

  return undefined;
}

function finding(
  source: ts.SourceFile,
  input: SourceInput,
  node: ts.Node,
  effect: string,
  category: SourceEffect['category'],
): SourceEffect {
  const location = source.getLineAndCharacterOfPosition(node.getStart(source));
  return {
    file: input.file,
    line: location.line + 1,
    column: location.character + 1,
    effect,
    category,
  };
}

function effectsIn(input: SourceInput): SourceEffect[] {
  const source = ts.createSourceFile(
    input.file,
    input.content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const found: SourceEffect[] = [];

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

export function analyzeSourceEffects(sources: readonly SourceInput[]): readonly SourceEffect[] {
  return sources.flatMap(effectsIn);
}
