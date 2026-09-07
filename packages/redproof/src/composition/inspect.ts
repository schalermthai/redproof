import { glob, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, matchesGlob, resolve, sep } from 'node:path';
import type { Scan } from '../domain/check.ts';
import type { Location } from '../domain/diagnostic.ts';

export type RootContext = { readonly root: string };

export type FileSelection =
  | string
  | readonly string[]
  | {
      readonly include: string | readonly string[];
      readonly exclude?: string | readonly string[];
    };

export type FindFilesOptions = Exclude<FileSelection, string | readonly string[]>;

function asArray(value: string | readonly string[]): readonly string[] {
  return typeof value === 'string' ? [value] : value;
}

function normalizePath(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/');
}

function isFindFilesOptions(selection: FileSelection): selection is FindFilesOptions {
  return typeof selection === 'object' && !Array.isArray(selection);
}

function selectionParts(selection: FileSelection): {
  include: readonly string[];
  exclude: readonly string[];
} {
  if (!isFindFilesOptions(selection)) {
    return { include: asArray(selection), exclude: [] };
  }

  return {
    include: asArray(selection.include),
    exclude: selection.exclude ? asArray(selection.exclude) : [],
  };
}

async function findFiles(ctx: RootContext, selection: FileSelection): Promise<readonly string[]> {
  const { include, exclude } = selectionParts(selection);
  const found = new Set<string>();

  for (const pattern of include) {
    for await (const entry of glob(pattern, { cwd: ctx.root })) {
      const path = normalizePath(entry);
      if (exclude.some(excluded => matchesGlob(path, excluded))) continue;
      const info = await stat(resolve(ctx.root, path));
      if (info.isFile()) found.add(path);
    }
  }

  return [...found].sort();
}

async function readText(ctx: RootContext, path: string): Promise<string> {
  return readFile(resolve(ctx.root, path), 'utf8');
}

async function writeText(ctx: RootContext, path: string, content: string): Promise<void> {
  const target = resolve(ctx.root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
}

async function pathExists(ctx: RootContext, path: string): Promise<boolean> {
  try {
    await stat(resolve(ctx.root, path));
    return true;
  } catch {
    return false;
  }
}

async function removePath(ctx: RootContext, path: string): Promise<void> {
  await rm(resolve(ctx.root, path), { recursive: true, force: true });
}

async function renamePath(ctx: RootContext, from: string, to: string): Promise<void> {
  const target = resolve(ctx.root, to);
  await mkdir(dirname(target), { recursive: true });
  await rename(resolve(ctx.root, from), target);
}

export const files = {
  find: findFiles,
  read: readText,
  write: writeText,
  exists: pathExists,
  remove: removePath,
  rename: renamePath,
};

export type TextMatch = {
  readonly file: string;
  readonly text: string;
  readonly range: {
    readonly start: number;
    readonly end: number;
  };
  readonly location: Location;
};

export type FindTextOptions = {
  readonly files: FileSelection;
  readonly find: string | RegExp;
};

export type ScanOptions = {
  /** Defaults to the search kind, `'text'` or `'json'`. */
  readonly source?: string;
  /** Defaults to the moment the search started. Pass an earlier time to widen the window. */
  readonly startedAt?: string;
};

/**
 * Describe one search as a Scan. `inspected` counts the files that search read.
 * A Check that runs several searches must build its own Scan, or its report
 * will under-count.
 */
export type SearchScan = (options?: ScanOptions) => Scan;

export type TextSearch = {
  readonly files: readonly string[];
  readonly matches: readonly TextMatch[];
  readonly scan: SearchScan;
};

function regexFor(find: string | RegExp): RegExp {
  if (typeof find === 'string') {
    const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(escaped, 'g');
  }

  const flags = find.flags.includes('g') ? find.flags : `${find.flags}g`;
  return new RegExp(find.source, flags);
}

function locationAt(file: string, content: string, offset: number): Location {
  const before = content.slice(0, offset);
  const lines = before.split('\n');
  return {
    file,
    line: lines.length,
    column: (lines.at(-1)?.length ?? 0) + 1,
  };
}

function scanner(kind: string, startedAt: string, inspected: number): SearchScan {
  const finishedAt = new Date().toISOString();
  return (options = {}) => ({
    source: options.source ?? kind,
    startedAt: options.startedAt ?? startedAt,
    finishedAt,
    inspected,
  });
}

async function findText(ctx: RootContext, options: FindTextOptions): Promise<TextSearch> {
  const startedAt = new Date().toISOString();
  const paths = await findFiles(ctx, options.files);
  const matches: TextMatch[] = [];

  for (const file of paths) {
    const content = await readText(ctx, file);
    const pattern = regexFor(options.find);

    for (let match = pattern.exec(content); match; match = pattern.exec(content)) {
      const text = match[0] ?? '';
      matches.push({
        file,
        text,
        range: { start: match.index, end: match.index + text.length },
        location: locationAt(file, content, match.index),
      });

      // A zero-width regex would otherwise loop forever.
      if (text.length === 0) pattern.lastIndex += 1;
    }
  }

  return { files: paths, matches, scan: scanner('text', startedAt, paths.length) };
}

async function findFirstText(ctx: RootContext, options: FindTextOptions): Promise<TextMatch | null> {
  const found = await findText(ctx, options);
  return found.matches[0] ?? null;
}

export const text = {
  find: findText,
  findFirst: findFirstText,
};

export type TextOccurrence = 'only' | 'first' | 'last' | number;

export type TextLocator = {
  readonly kind: 'text';
  readonly files: FileSelection;
  readonly find: string | RegExp;
  readonly occurrence: TextOccurrence;
};

function locateText(options: FindTextOptions & { readonly occurrence?: TextOccurrence }): TextLocator {
  return {
    kind: 'text',
    files: options.files,
    find: options.find,
    occurrence: options.occurrence ?? 'only',
  };
}

export async function resolveTextLocator(ctx: RootContext, locator: TextLocator): Promise<TextMatch> {
  const found = await findText(ctx, { files: locator.files, find: locator.find });
  const matches = found.matches;

  if (matches.length === 0) {
    throw new Error('Text locator did not match anything.');
  }

  switch (locator.occurrence) {
    case 'only':
      if (matches.length !== 1) {
        throw new Error(`Text locator expected exactly one match but found ${matches.length}.`);
      }
      return matches[0]!;
    case 'first':
      return matches[0]!;
    case 'last':
      return matches.at(-1)!;
    default: {
      if (!Number.isInteger(locator.occurrence) || locator.occurrence < 0) {
        throw new Error('Text locator occurrence must be a non-negative zero-based index.');
      }
      const match = matches[locator.occurrence];
      if (!match) {
        throw new Error(
          `Text locator occurrence ${locator.occurrence} is out of range for ${matches.length} matches.`,
        );
      }
      return match;
    }
  }
}


export type JsonPathToken =
  | { readonly kind: 'property'; readonly key: string }
  | { readonly kind: 'index'; readonly index: number }
  | { readonly kind: 'wildcard' };

export type JsonOccurrence = TextOccurrence;

export type JsonLocator = {
  readonly kind: 'json';
  readonly files: FileSelection;
  readonly path: string;
  readonly occurrence: JsonOccurrence;
};

export type FindJsonOptions = {
  readonly files: FileSelection;
  readonly path: string;
};

export type JsonMatch = {
  readonly file: string;
  readonly path: string;
  readonly value: unknown;
};

export type JsonSearch = {
  readonly files: readonly string[];
  readonly matches: readonly JsonMatch[];
  readonly scan: SearchScan;
};

type JsonResolvedMatch = JsonMatch & {
  readonly parent: Record<string, unknown> | unknown[] | null;
  readonly key: string | number | null;
  readonly document: unknown;
  readonly original: string;
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

type JsonNodeMatch = {
  value: unknown;
  parent: Record<string, unknown> | unknown[] | null;
  key: string | number | null;
  path: string;
};

function resolveJsonDocument(document: unknown, tokens: readonly JsonPathToken[]): JsonNodeMatch[] {
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

async function queryJson(ctx: RootContext, options: FindJsonOptions): Promise<JsonSearch> {
  const startedAt = new Date().toISOString();
  const paths = await findFiles(ctx, options.files);
  const tokens = parseJsonPath(options.path);
  const matches: JsonMatch[] = [];

  for (const file of paths) {
    const original = await readText(ctx, file);
    let document: unknown;
    try {
      document = JSON.parse(original);
    } catch (error) {
      throw new Error(`Could not parse JSON file ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }

    for (const match of resolveJsonDocument(document, tokens)) {
      matches.push({ file, path: match.path, value: match.value });
    }
  }

  return { files: paths, matches, scan: scanner('json', startedAt, paths.length) };
}

export const json = {
  query: queryJson,
};

function locateJson(options: FindJsonOptions & { readonly occurrence?: JsonOccurrence }): JsonLocator {
  return {
    kind: 'json',
    files: options.files,
    path: options.path,
    occurrence: options.occurrence ?? 'only',
  };
}

export const locate = {
  text: locateText,
  json: locateJson,
};

function selectOccurrence<T>(matches: readonly T[], occurrence: TextOccurrence, label: string): T {
  if (matches.length === 0) throw new Error(`${label} did not match anything.`);

  switch (occurrence) {
    case 'only':
      if (matches.length !== 1) throw new Error(`${label} expected exactly one match but found ${matches.length}.`);
      return matches[0]!;
    case 'first':
      return matches[0]!;
    case 'last':
      return matches.at(-1)!;
    default: {
      if (!Number.isInteger(occurrence) || occurrence < 0) {
        throw new Error(`${label} occurrence must be a non-negative zero-based index.`);
      }
      const match = matches[occurrence];
      if (!match) throw new Error(`${label} occurrence ${occurrence} is out of range for ${matches.length} matches.`);
      return match;
    }
  }
}

export async function resolveJsonLocator(ctx: RootContext, locator: JsonLocator): Promise<JsonResolvedMatch> {
  const paths = await findFiles(ctx, locator.files);
  const tokens = parseJsonPath(locator.path);
  const resolved: JsonResolvedMatch[] = [];

  for (const file of paths) {
    const original = await readText(ctx, file);
    let document: unknown;
    try {
      document = JSON.parse(original);
    } catch (error) {
      throw new Error(`Could not parse JSON file ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }

    for (const match of resolveJsonDocument(document, tokens)) {
      resolved.push({ file, path: match.path, value: match.value, parent: match.parent, key: match.key, document, original });
    }
  }

  return selectOccurrence(resolved, locator.occurrence, 'JSON locator');
}
