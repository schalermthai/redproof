import {
  parseJsonDocument,
  parseJsonPath,
  queryJsonDocument,
  type FindJsonOptions,
  type JsonMatch,
} from '../core/json.ts';
import { selectOccurrence, type JsonLocator, type TextLocator } from '../core/locate.ts';
import { searchScan, type SearchScan } from '../core/scan.ts';
import { matchText, type FindTextOptions, type TextMatch } from '../core/text.ts';
import { files, type RootContext } from './files.ts';

const now = (): string => new Date().toISOString();

export type TextSearch = {
  readonly files: readonly string[];
  readonly matches: readonly TextMatch[];
  readonly scan: SearchScan;
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

async function findText(ctx: RootContext, options: FindTextOptions): Promise<TextSearch> {
  const startedAt = now();
  const paths = await files.find(ctx, options.files);
  const matches: TextMatch[] = [];

  for (const file of paths) {
    matches.push(...matchText(file, await files.read(ctx, file), options.find));
  }

  return { files: paths, matches, scan: searchScan('text', startedAt, now(), paths.length) };
}

async function findFirstText(ctx: RootContext, options: FindTextOptions): Promise<TextMatch | null> {
  const found = await findText(ctx, options);
  return found.matches[0] ?? null;
}

export const text = {
  find: findText,
  findFirst: findFirstText,
};

export async function resolveTextLocator(ctx: RootContext, locator: TextLocator): Promise<TextMatch> {
  const found = await findText(ctx, { files: locator.files, find: locator.find });
  return selectOccurrence(found.matches, locator.occurrence, 'Text locator');
}

async function resolvedJsonMatches(ctx: RootContext, options: FindJsonOptions): Promise<JsonResolvedMatch[]> {
  const paths = await files.find(ctx, options.files);
  const tokens = parseJsonPath(options.path);
  const resolved: JsonResolvedMatch[] = [];

  for (const file of paths) {
    const original = await files.read(ctx, file);
    const document = parseJsonDocument(file, original);
    for (const match of queryJsonDocument(document, tokens)) {
      resolved.push({ file, path: match.path, value: match.value, parent: match.parent, key: match.key, document, original });
    }
  }

  return resolved;
}

async function queryJson(ctx: RootContext, options: FindJsonOptions): Promise<JsonSearch> {
  const startedAt = now();
  const paths = await files.find(ctx, options.files);
  const tokens = parseJsonPath(options.path);
  const matches: JsonMatch[] = [];

  for (const file of paths) {
    const document = parseJsonDocument(file, await files.read(ctx, file));
    for (const match of queryJsonDocument(document, tokens)) {
      matches.push({ file, path: match.path, value: match.value });
    }
  }

  return { files: paths, matches, scan: searchScan('json', startedAt, now(), paths.length) };
}

export const json = {
  query: queryJson,
};

export async function resolveJsonLocator(ctx: RootContext, locator: JsonLocator): Promise<JsonResolvedMatch> {
  const resolved = await resolvedJsonMatches(ctx, { files: locator.files, path: locator.path });
  return selectOccurrence(resolved, locator.occurrence, 'JSON locator');
}
