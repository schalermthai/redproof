import type { FindJsonOptions } from './json.ts';
import type { FileSelection } from './selection.ts';
import type { FindTextOptions } from './text.ts';

export type TextOccurrence = 'only' | 'first' | 'last' | number;
export type JsonOccurrence = TextOccurrence;

export type TextLocator = {
  readonly kind: 'text';
  readonly files: FileSelection;
  readonly find: string | RegExp;
  readonly occurrence: TextOccurrence;
};

export type JsonLocator = {
  readonly kind: 'json';
  readonly files: FileSelection;
  readonly path: string;
  readonly occurrence: JsonOccurrence;
};

function locateText(options: FindTextOptions & { readonly occurrence?: TextOccurrence }): TextLocator {
  return {
    kind: 'text',
    files: options.files,
    find: options.find,
    occurrence: options.occurrence ?? 'only',
  };
}

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

/** Pick one match by occurrence. `only` demands exactly one. A number is a zero-based index. */
export function selectOccurrence<T>(matches: readonly T[], occurrence: TextOccurrence, label: string): T {
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
