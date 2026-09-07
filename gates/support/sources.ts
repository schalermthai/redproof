import { glob, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export type SourceFile = {
  readonly file: string;
  readonly content: string;
};

/** Every file matching `pattern`, in a stable order, with its content. */
export async function readSources(root: string, pattern: string): Promise<SourceFile[]> {
  const files: string[] = [];
  for await (const file of glob(pattern, { cwd: root })) files.push(file);
  files.sort();

  return Promise.all(files.map(async file => ({
    file,
    content: await readFile(join(root, file), 'utf8'),
  })));
}

/** Every path matching any pattern. Dependency directories are excluded. */
export async function listPaths(root: string, patterns: readonly string[]): Promise<Set<string>> {
  const paths = new Set<string>();
  for (const pattern of patterns) {
    for await (const file of glob(pattern, { cwd: root })) {
      if (!file.includes('/node_modules/')) paths.add(file);
    }
  }
  return paths;
}
