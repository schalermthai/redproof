import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { CheckProjectRun } from '../../run/index.ts';
import type { SourceExcerpts } from '../core/terminal.ts';

function locatedFiles(run: CheckProjectRun): Set<string> {
  const files = new Set<string>();
  for (const item of run.results) {
    if (item.result.verdict === 'fail') {
      for (const breach of item.result.breaches) {
        if (breach.location?.line != null) files.add(breach.location.file);
      }
    }
    if (item.result.verdict === 'refuse' && item.result.why.location?.line != null) {
      files.add(item.result.why.location.file);
    }
  }
  return files;
}

/** Read every source file a Diagnostic points into. A file that cannot be read is left out, never an error. */
export async function loadSourceExcerpts(run: CheckProjectRun): Promise<SourceExcerpts> {
  const sources = new Map<string, readonly string[]>();
  for (const file of locatedFiles(run)) {
    try {
      sources.set(file, (await readFile(resolve(run.project.root, file), 'utf8')).split(/\r?\n/));
    } catch {
      // absent excerpt
    }
  }
  return sources;
}
