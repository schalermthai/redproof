import type { Mutation } from '../../domain/mutation.ts';
import { resolveJsonLocator, type JsonLocator } from '../inspect.ts';
import { defineMutation } from './define.ts';

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

function indentationOf(source: string): string | number {
  const match = source.match(/\n([\t ]+)\S/);
  if (!match) return 2;
  return match[1]!.includes('\t') ? '\t' : match[1]!.length;
}

function serializeLike(source: string, value: unknown): string {
  const finalNewline = source.endsWith('\n') ? (source.endsWith('\r\n') ? '\r\n' : '\n') : '';
  return JSON.stringify(value, null, indentationOf(source)) + finalNewline;
}

function ensureMutableTarget(match: Awaited<ReturnType<typeof resolveJsonLocator>>): asserts match is typeof match & {
  parent: Record<string, unknown> | unknown[];
  key: string | number;
} {
  if (match.parent === null || match.key === null) {
    throw new Error('Mutating the JSON document root is not supported by this operation.');
  }
}

function mutateJson(
  description: string,
  locator: JsonLocator,
  change: (match: Awaited<ReturnType<typeof resolveJsonLocator>>) => void,
): Mutation {
  return defineMutation({
    description,
    async apply(ctx) {
      const match = await resolveJsonLocator(ctx, locator);
      const before = match.original;
      change(match);
      await ctx.files.write(match.file, serializeLike(before, match.document));
      return async () => ctx.files.write(match.file, before);
    },
  });
}

export const jsonMutations = {
  jsonSet(locator: JsonLocator, value: JsonValue): Mutation {
    return mutateJson(`set ${locator.path}`, locator, match => {
      ensureMutableTarget(match);
      if (Array.isArray(match.parent) && typeof match.key === 'number') match.parent[match.key] = value;
      else (match.parent as Record<string, unknown>)[String(match.key)] = value;
    });
  },

  jsonDelete(locator: JsonLocator): Mutation {
    return mutateJson(`delete ${locator.path}`, locator, match => {
      ensureMutableTarget(match);
      if (Array.isArray(match.parent) && typeof match.key === 'number') match.parent.splice(match.key, 1);
      else delete (match.parent as Record<string, unknown>)[String(match.key)];
    });
  },

  jsonMerge(locator: JsonLocator, patch: Readonly<Record<string, JsonValue>>): Mutation {
    return mutateJson(`merge ${locator.path}`, locator, match => {
      if (match.value === null || typeof match.value !== 'object' || Array.isArray(match.value)) {
        throw new Error(`JSON merge target ${match.path} must be an object.`);
      }
      Object.assign(match.value as Record<string, unknown>, patch);
    });
  },

  jsonPush(locator: JsonLocator, value: JsonValue): Mutation {
    return mutateJson(`push into ${locator.path}`, locator, match => {
      if (!Array.isArray(match.value)) throw new Error(`JSON push target ${match.path} must be an array.`);
      match.value.push(value);
    });
  },
};
