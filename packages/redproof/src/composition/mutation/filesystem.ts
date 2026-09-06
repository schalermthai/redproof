import { lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Mutation } from '../../domain/mutation.ts';
import { defineMutation } from './define.ts';

export const filesystemMutations = {
  createFile(path: string, content: string): Mutation {
    return defineMutation({
      description: `create ${path}`,
      capture: path,
      async apply(ctx) {
        if (await ctx.files.exists(path)) throw new Error(`Cannot create ${path}: path already exists.`);
        await ctx.files.write(path, content);
      },
    });
  },

  writeText(path: string, text: string): Mutation {
    return defineMutation({
      description: `write ${path}`,
      capture: path,
      async apply(ctx) {
        await ctx.files.write(path, text);
      },
    });
  },

  remove(path: string): Mutation {
    return defineMutation({
      description: `remove ${path}`,
      capture: path,
      async apply(ctx) {
        if (!(await ctx.files.exists(path))) throw new Error(`Cannot remove ${path}: path does not exist.`);
        await ctx.files.remove(path);
      },
    });
  },

  deleteFile(path: string): Mutation {
    return defineMutation({
      description: `delete ${path}`,
      capture: path,
      async apply(ctx) {
        const target = resolve(ctx.root, path);
        if (!(await ctx.files.exists(path))) throw new Error(`Cannot delete ${path}: file does not exist.`);
        if (!(await lstat(target)).isFile()) throw new Error(`Cannot delete ${path}: path is not a file.`);
        await ctx.files.remove(path);
      },
    });
  },

  rename(from: string, to: string): Mutation {
    return defineMutation({
      description: `rename ${from} to ${to}`,
      capture: [from, to],
      async apply(ctx) {
        if (!(await ctx.files.exists(from))) throw new Error(`Cannot rename ${from}: path does not exist.`);
        await ctx.files.rename(from, to);
      },
    });
  },

  move(from: string, to: string): Mutation {
    return defineMutation({
      description: `move ${from} to ${to}`,
      capture: [from, to],
      async apply(ctx) {
        if (!(await ctx.files.exists(from))) throw new Error(`Cannot move ${from}: path does not exist.`);
        await ctx.files.rename(from, to);
      },
    });
  },
};
