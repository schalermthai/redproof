// Type-checks every TypeScript example in the documentation.
//
// A ```ts block must compile on its own. A block that is deliberately a
// snippet must say so with ```ts fragment, and the run reports how many
// were skipped.
//
// Usage: node --experimental-strip-types scripts/typecheck-docs.ts

import { execFileSync } from 'node:child_process';
import { glob, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '..');
const WORKDIR = join(REPO, 'docs-typecheck-tmp');
const PROJECT = join(REPO, 'tsconfig.docs.json');
const SOURCES = ['README.md', 'docs/**/*.md'];

const FENCE = /^```(ts|typescript)([^\n]*)\n([\s\S]*?)^```$/gm;

type Block = {
  readonly doc: string;
  readonly index: number;
  readonly firstLine: number;
  readonly code: string;
};

type Extraction = {
  readonly checked: Block[];
  readonly skipped: number;
};

async function markdownFiles(): Promise<string[]> {
  const found = new Set<string>();
  for (const pattern of SOURCES) {
    for await (const file of glob(pattern, { cwd: REPO })) found.add(file);
  }
  return [...found].sort();
}

function extract(doc: string, content: string): Extraction {
  const checked: Block[] = [];
  let skipped = 0;
  let index = 0;

  for (const match of content.matchAll(FENCE)) {
    const marker = (match[2] ?? '').trim();
    const code = match[3] ?? '';
    const firstLine = content.slice(0, match.index).split('\n').length + 1;

    if (marker === 'fragment') {
      skipped += 1;
    } else if (marker === '') {
      checked.push({ doc, index, firstLine, code });
    } else {
      throw new Error(
        `${doc}:${firstLine}: unknown code fence marker "${marker}". Use \`\`\`ts or \`\`\`ts fragment.`,
      );
    }

    index += 1;
  }

  return { checked, skipped };
}

function slug(doc: string): string {
  return doc.replace(/[/\\]/g, '__').replace(/\.md$/, '');
}

/** Rewrite a temp-file diagnostic so it points at the line in the real document. */
function toDocLocation(line: string, blocks: ReadonlyMap<string, Block>): string {
  const match = /^(.+?)\((\d+),(\d+)\): (.*)$/.exec(line.trim());
  if (!match) return line;

  const block = blocks.get(relative(WORKDIR, resolve(REPO, match[1]!)));
  if (!block) return line;

  const docLine = block.firstLine + Number(match[2]) - 1;
  return `${block.doc}:${docLine}:${match[3]} (block ${block.index}): ${match[4]}`;
}

await rm(WORKDIR, { recursive: true, force: true });
await mkdir(WORKDIR, { recursive: true });

const blocks = new Map<string, Block>();
let skipped = 0;
let docCount = 0;

try {
  for (const doc of await markdownFiles()) {
    const content = await readFile(join(REPO, doc), 'utf8');
    const extraction = extract(doc, content);
    docCount += 1;
    skipped += extraction.skipped;

    for (const block of extraction.checked) {
      const file = `${slug(doc)}__${block.index}.ts`;
      blocks.set(file, block);
      await mkdir(dirname(join(WORKDIR, file)), { recursive: true });
      await writeFile(join(WORKDIR, file), block.code, 'utf8');
    }
  }

  console.log(
    `Checking ${blocks.size} TypeScript examples from ${docCount} documents. `
    + `${skipped} marked as fragments.`,
  );

  if (blocks.size === 0) {
    console.error('No checkable examples were found. The extractor is not working.');
    process.exitCode = 1;
  } else {
    try {
      execFileSync(join(REPO, 'node_modules', '.bin', 'tsc'), ['-p', PROJECT], {
        cwd: REPO,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      console.log('All documentation examples type-check.');
    } catch (error) {
      const output = (error as { stdout?: string; stderr?: string });
      const lines = `${output.stdout ?? ''}${output.stderr ?? ''}`
        .split('\n')
        .filter(line => line.trim().length > 0);

      console.error('\nDocumentation examples failed to type-check:\n');
      for (const line of lines) console.error(`  ${toDocLocation(line, blocks)}`);
      console.error('\nFix the example, or mark the block ```ts fragment if it is a snippet.');
      process.exitCode = 1;
    }
  }
} finally {
  await rm(WORKDIR, { recursive: true, force: true });
}
