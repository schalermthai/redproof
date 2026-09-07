import { matchesGlob, sep } from 'node:path';

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

function isFindFilesOptions(selection: FileSelection): selection is FindFilesOptions {
  return typeof selection === 'object' && !Array.isArray(selection);
}

export function selectionParts(selection: FileSelection): {
  readonly include: readonly string[];
  readonly exclude: readonly string[];
} {
  if (!isFindFilesOptions(selection)) {
    return { include: asArray(selection), exclude: [] };
  }

  return {
    include: asArray(selection.include),
    exclude: selection.exclude ? asArray(selection.exclude) : [],
  };
}

/** Paths are reported with forward slashes on every platform. */
export function normalizePath(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/');
}

export function isExcluded(path: string, exclude: readonly string[]): boolean {
  return exclude.some(excluded => matchesGlob(path, excluded));
}
