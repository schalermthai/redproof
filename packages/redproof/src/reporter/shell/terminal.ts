import type { CheckProjectRun } from '../../run/index.ts';
import { renderRun, type ReportOptions } from '../core/terminal.ts';
import { loadSourceExcerpts } from './sources.ts';

export async function formatRun(run: CheckProjectRun, options: ReportOptions = {}): Promise<string> {
  return renderRun(run, await loadSourceExcerpts(run), options);
}
