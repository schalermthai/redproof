import type { Mutation } from '../../../domain/index.ts';
import {
  resolveTextLocator,
  type FindTextOptions,
  type TextLocator,
} from '../../../inspect/index.ts';
import { defineMutation } from './define.ts';

function locatorDescription(locator: TextLocator): string {
  return typeof locator.find === 'string' ? JSON.stringify(locator.find) : locator.find.toString();
}

function mutateLocatedText(
  description: string,
  locator: TextLocator,
  update: (content: string, start: number, end: number) => string,
): Mutation {
  return defineMutation({
    description,
    async apply(ctx) {
      const match = await resolveTextLocator(ctx, locator);
      const before = await ctx.files.read(match.file);
      const after = update(before, match.range.start, match.range.end);
      await ctx.files.write(match.file, after);
      return async () => ctx.files.write(match.file, before);
    },
  });
}

function lineRange(content: string, line: number): { start: number; end: number } {
  if (!Number.isInteger(line) || line < 1) throw new Error('Line number must be a positive 1-based integer.');
  const starts = [0];
  for (let i = 0; i < content.length; i += 1) {
    if (content[i] === '\n') starts.push(i + 1);
  }

  if (line > starts.length) throw new Error(`Line ${line} is out of range; file has ${starts.length} lines.`);
  const start = starts[line - 1]!;
  const next = starts[line];
  return { start, end: next ?? content.length };
}

export const textMutations = {
  appendText(path: string, text: string): Mutation {
    return defineMutation({
      description: `append text to ${path}`,
      async apply(ctx) {
        const before = await ctx.files.read(path);
        await ctx.files.write(path, before + text);
        return async () => ctx.files.write(path, before);
      },
    });
  },

  replaceText(locator: TextLocator, replacement: string): Mutation {
    return mutateLocatedText(
      `replace ${locatorDescription(locator)}`,
      locator,
      (content, start, end) => content.slice(0, start) + replacement + content.slice(end),
    );
  },

  replaceAllText(options: FindTextOptions, replacement: string): Mutation {
    const label = typeof options.find === 'string' ? JSON.stringify(options.find) : options.find.toString();
    return defineMutation({
      description: `replace all ${label}`,
      async apply(ctx) {
        const found = await ctx.text.find(options);
        if (found.matches.length === 0) throw new Error('replaceAllText did not match anything.');
        const byFile = new Map<string, typeof found.matches>();
        for (const match of found.matches) {
          const existing = byFile.get(match.file) ?? [];
          byFile.set(match.file, [...existing, match]);
        }

        const before = new Map<string, string>();
        for (const [file, matches] of byFile) {
          const original = await ctx.files.read(file);
          before.set(file, original);
          let changed = original;
          for (const match of [...matches].sort((a, b) => b.range.start - a.range.start)) {
            changed = changed.slice(0, match.range.start) + replacement + changed.slice(match.range.end);
          }
          await ctx.files.write(file, changed);
        }

        return async () => {
          for (const [file, original] of before) await ctx.files.write(file, original);
        };
      },
    });
  },

  insertBefore(locator: TextLocator, text: string): Mutation {
    return mutateLocatedText(
      `insert text before ${locatorDescription(locator)}`,
      locator,
      (content, start) => content.slice(0, start) + text + content.slice(start),
    );
  },

  insertAfter(locator: TextLocator, text: string): Mutation {
    return mutateLocatedText(
      `insert text after ${locatorDescription(locator)}`,
      locator,
      (content, _start, end) => content.slice(0, end) + text + content.slice(end),
    );
  },

  removeText(locator: TextLocator): Mutation {
    return mutateLocatedText(
      `remove ${locatorDescription(locator)}`,
      locator,
      (content, start, end) => content.slice(0, start) + content.slice(end),
    );
  },

  insertLine(path: string, line: number, text: string): Mutation {
    return defineMutation({
      description: `insert line ${line} in ${path}`,
      async apply(ctx) {
        const before = await ctx.files.read(path);
        const range = lineRange(before, line);
        const eol = before.includes('\r\n') ? '\r\n' : '\n';
        const insertion = text.endsWith('\n') || text.endsWith('\r\n') ? text : text + eol;
        await ctx.files.write(path, before.slice(0, range.start) + insertion + before.slice(range.start));
        return async () => ctx.files.write(path, before);
      },
    });
  },

  removeLine(path: string, line: number): Mutation {
    return defineMutation({
      description: `remove line ${line} from ${path}`,
      async apply(ctx) {
        const before = await ctx.files.read(path);
        const range = lineRange(before, line);
        await ctx.files.write(path, before.slice(0, range.start) + before.slice(range.end));
        return async () => ctx.files.write(path, before);
      },
    });
  },
};
