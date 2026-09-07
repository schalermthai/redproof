import type { FileSelection } from './selection.ts';

export type JsonPathToken =
  | { readonly kind: 'property'; readonly key: string }
  | { readonly kind: 'index'; readonly index: number }
  | { readonly kind: 'wildcard' };

export type FindJsonOptions = {
  readonly files: FileSelection;
  readonly path: string;
};

export type JsonMatch = {
  readonly file: string;
  readonly path: string;
  readonly value: unknown;
};

export type JsonNodeMatch = {
  value: unknown;
  parent: Record<string, unknown> | unknown[] | null;
  key: string | number | null;
  path: string;
};

function isIdentifierKey(key: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key);
}

function childJsonPath(base: string, key: string | number): string {
  if (typeof key === 'number') return `${base}[${key}]`;
  return isIdentifierKey(key) ? `${base}.${key}` : `${base}[${JSON.stringify(key)}]`;
}

export function parseJsonPath(path: string): readonly JsonPathToken[] {
  if (!path.startsWith('$')) throw new Error('JSONPath must start with $.');
  const tokens: JsonPathToken[] = [];
  let i = 1;

  while (i < path.length) {
    const char = path[i];

    if (char === '.') {
      i += 1;
      if (path[i] === '.') throw new Error('Recursive descent (..) is not supported by Redproof JSONPath.');
      if (path[i] === '*') {
        tokens.push({ kind: 'wildcard' });
        i += 1;
        continue;
      }

      const start = i;
      while (i < path.length && path[i] !== '.' && path[i] !== '[') i += 1;
      const key = path.slice(start, i);
      if (!key) throw new Error(`Invalid JSONPath near position ${start}.`);
      tokens.push({ kind: 'property', key });
      continue;
    }

    if (char === '[') {
      i += 1;
      while (path[i] === ' ') i += 1;

      if (path[i] === '*') {
        i += 1;
        while (path[i] === ' ') i += 1;
        if (path[i] !== ']') throw new Error(`Invalid JSONPath wildcard near position ${i}.`);
        i += 1;
        tokens.push({ kind: 'wildcard' });
        continue;
      }

      if (path[i] === '"' || path[i] === "'") {
        const quote = path[i]!;
        i += 1;
        let key = '';
        let closed = false;
        while (i < path.length) {
          const c = path[i]!;
          if (c === '\\') {
            const next = path[i + 1];
            if (next === undefined) throw new Error('Invalid JSONPath escape.');
            key += next;
            i += 2;
            continue;
          }
          if (c === quote) {
            closed = true;
            i += 1;
            break;
          }
          key += c;
          i += 1;
        }
        if (!closed) throw new Error('Unterminated quoted JSONPath property.');
        while (path[i] === ' ') i += 1;
        if (path[i] !== ']') throw new Error(`Expected ] near position ${i}.`);
        i += 1;
        tokens.push({ kind: 'property', key });
        continue;
      }

      const start = i;
      while (i < path.length && /[0-9]/.test(path[i]!)) i += 1;
      const raw = path.slice(start, i);
      while (path[i] === ' ') i += 1;
      if (!raw || path[i] !== ']') throw new Error(`Invalid JSONPath array index near position ${start}.`);
      i += 1;
      tokens.push({ kind: 'index', index: Number(raw) });
      continue;
    }

    throw new Error(`Unsupported JSONPath syntax near position ${i}: ${JSON.stringify(char)}.`);
  }

  return tokens;
}

/** Every node the tokens select, with the parent and key needed to change it. */
export function queryJsonDocument(document: unknown, tokens: readonly JsonPathToken[]): JsonNodeMatch[] {
  let current: JsonNodeMatch[] = [{ value: document, parent: null, key: null, path: '$' }];

  for (const token of tokens) {
    const next: JsonNodeMatch[] = [];
    for (const match of current) {
      const value = match.value;

      if (token.kind === 'property') {
        if (value !== null && typeof value === 'object' && !Array.isArray(value) && token.key in value) {
          const object = value as Record<string, unknown>;
          next.push({ value: object[token.key], parent: object, key: token.key, path: childJsonPath(match.path, token.key) });
        }
        continue;
      }

      if (token.kind === 'index') {
        if (Array.isArray(value) && token.index < value.length) {
          next.push({ value: value[token.index], parent: value, key: token.index, path: childJsonPath(match.path, token.index) });
        }
        continue;
      }

      if (Array.isArray(value)) {
        value.forEach((item, index) => next.push({ value: item, parent: value, key: index, path: childJsonPath(match.path, index) }));
      } else if (value !== null && typeof value === 'object') {
        const object = value as Record<string, unknown>;
        Object.entries(object).forEach(([key, item]) => next.push({ value: item, parent: object, key, path: childJsonPath(match.path, key) }));
      }
    }
    current = next;
  }

  return current;
}

export function parseJsonDocument(file: string, original: string): unknown {
  try {
    return JSON.parse(original);
  } catch (error) {
    throw new Error(`Could not parse JSON file ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
