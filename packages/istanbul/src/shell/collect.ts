import { constants, type Stats } from 'node:fs';
import { lstat, mkdtemp, open, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { result, type CheckContext, type CheckResult, type RuleRef } from 'redproof';
import { executeCommand } from 'redproof/command';
import { coverageBreaches, coveragePath, parseCoverage } from '../core/model.ts';
import type { CoverageConfig, CoverageContext, Selection } from '../core/options.ts';
import { missingInventory, plannedArguments, producerOutcome, reportIdentity, scan, unavailable,
  type PlannedCommand, type Refusal, type ReportStat } from '../core/report.ts';

export type Plan = (context: CoverageContext) => Promise<PlannedCommand | Refusal>;
type Report = { readonly kind: 'report'; readonly text: string };

function identity(stat: Stats): ReportStat {
  return { file: stat.isFile(), symlink: stat.isSymbolicLink(), nlink: stat.nlink, size: stat.size, ino: stat.ino, dev: stat.dev };
}
async function readReport(reportFile: string, maxReportBytes: number): Promise<Report | Refusal> {
  const stat = await lstat(reportFile);
  const expected = identity(stat);
  const untrusted = reportIdentity(expected, undefined, maxReportBytes);
  if (untrusted) return untrusted;
  const handle = await open(reportFile, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const changed = reportIdentity(expected, identity(await handle.stat()), maxReportBytes);
    if (changed) return changed;
    const bytes = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = await handle.read(bytes, length, bytes.length - length, null);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    if (length !== stat.size) return unavailable('Coverage report size changed while reading.');
    return { kind: 'report', text: bytes.toString('utf8', 0, length) };
  } finally { await handle.close(); }
}

export async function collect<R extends RuleRef>(ctx: CheckContext<R>, config: CoverageConfig, selected: Selection<R>, plan: Plan): Promise<CheckResult<R>> {
  const startedAt = new Date().toISOString();
  const refuse = (why: Refusal) => result.refuse(scan(startedAt, new Date().toISOString(), null), {
    code: why.code, message: why.message, location: null, ...(why.detail ? { detail: why.detail } : {}),
  });
  let temp: string | undefined;
  const outcome = await (async () => {
    try {
      const root = await realpath(ctx.root), cwd = await realpath(resolve(root, config.cwd));
      if (cwd !== root) coveragePath(root, cwd);
      const required = await Promise.all(config.expectedFiles.map(async file => coveragePath(root, await realpath(resolve(root, file)))));
      temp = await mkdtemp(join(tmpdir(), 'redproof-istanbul-'));
      const reportFile = join(temp, 'coverage-final.json');
      const planned = await plan({ root, cwd, reportDirectory: temp, reportFile, tempDirectory: join(temp, 'raw') });
      if (planned.kind === 'refused') return refuse(planned);
      const invalid = plannedArguments(planned);
      if (invalid) return refuse(invalid);
      const execution = await executeCommand({ command: planned.command, args: planned.args, cwd,
        timeoutMs: config.timeoutMs, maxOutputBytes: config.maxOutputBytes,
        env: { NODE_TEST_CONTEXT: undefined, REDPROOF_COVERAGE_REPORT: reportFile } });
      const unsuccessful = producerOutcome(execution);
      if (unsuccessful) return refuse(unsuccessful);
      const report = await readReport(reportFile, config.maxReportBytes);
      if (report.kind === 'refused') return refuse(report);
      const evidence = parseCoverage(report.text, root);
      for (const file of evidence.files) {
        coveragePath(root, await realpath(resolve(root, file.file)));
      }
      const missing = missingInventory(required, evidence);
      if (missing) return refuse(missing);
      return result.fromBreaches(scan(startedAt, new Date().toISOString(), evidence.files.length), coverageBreaches(evidence, selected));
    } catch (error) {
      return refuse(unavailable(error instanceof Error ? error.message : String(error)));
    }
  })();
  if (temp) {
    try { await rm(temp, { recursive: true, force: true }); }
    catch (error) {
      if (outcome.verdict === 'pass') return refuse({ kind: 'refused', code: 'istanbul-cleanup-unavailable', message: 'Could not clean up private coverage artifacts.', detail: String(error) });
    }
  }
  return outcome;
}
