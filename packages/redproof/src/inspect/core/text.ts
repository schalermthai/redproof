import type { Location } from '../../domain/index.ts';
import type { FileSelection } from './selection.ts';

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

/** Every match of `find` in one file's content, in document order. */
export function matchText(file: string, content: string, find: string | RegExp): TextMatch[] {
  const pattern = regexFor(find);
  const matches: TextMatch[] = [];

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

  return matches;
}
