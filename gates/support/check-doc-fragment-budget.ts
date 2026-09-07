import { glob, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const MAX_FRAGMENTS = 39;
const FENCE = /^```(?:ts|typescript)([^\n]*)\n[\s\S]*?^```$/gm;

let fragments = 0;
let documents = 0;

for (const pattern of ['README.md', 'docs/**/*.md']) {
  for await (const file of glob(pattern, { cwd: ROOT })) {
    documents += 1;
    const content = await readFile(join(ROOT, file), 'utf8');
    for (const match of content.matchAll(FENCE)) {
      if ((match[1] ?? '').trim() === 'fragment') fragments += 1;
    }
  }
}

if (fragments > MAX_FRAGMENTS) {
  console.error(
    `Documentation fragment debt grew to ${fragments}; the current maximum is ${MAX_FRAGMENTS}.`,
  );
  process.exitCode = 1;
} else {
  console.log(
    `Documentation fragment debt is ${fragments}/${MAX_FRAGMENTS} across ${documents} documents.`,
  );
}
