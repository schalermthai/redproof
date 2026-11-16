import { lstat, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { result, type CheckContext, type CheckResult, type RuleRef } from 'redproof';
import { executeCommand } from 'redproof/command';
import { jsonArgs, probeArgs, runArgs } from '../core/argv.ts';
import { configExclusions, parseProjectConfig } from '../core/config.ts';
import { decide } from '../core/decide.ts';
import { parseCoveragePy } from '../core/evidence.ts';
import type { CoveragePyConfig } from '../core/options.ts';
import { cleanupUnavailable, producerOutcome, reportIdentity, scan, unavailable, type Refusal } from '../core/refusals.ts';
import type { Selection } from '../core/rules.ts';
import { confineRequired, confineRoots, trustFiles, type Resolved } from '../core/trust.ts';

/** Shell: gather raw facts (real paths, command results, the report text) and hand every judgement to the core. */
async function resolveOnDisk(root: string, file: string): Promise<readonly [string, Resolved]> {
  try { return [file, { real: await realpath(resolve(root, file)) }]; }
  catch (error) { return [file, { error: error instanceof Error ? error.message : String(error) }]; }
}

export async function collect<R extends RuleRef>(ctx: CheckContext<R>, config: CoveragePyConfig, selected: Selection<R>): Promise<CheckResult<R>> {
  const startedAt = new Date().toISOString();
  const refuse = (why: Refusal) => result.refuse(scan(startedAt, new Date().toISOString(), null), {
    code: why.code, message: why.message, location: null, ...(why.detail ? { detail: why.detail } : {}),
  });
  let temp: string | undefined;
  const outcome = await (async () => {
    try {
      const root = await realpath(ctx.root), cwd = await realpath(resolve(root, config.cwd));
      const rcfile = config.rcfile ? await realpath(resolve(root, config.rcfile)) : undefined;
      const escaped = confineRoots(root, cwd, rcfile);
      if (escaped) return refuse(escaped);
      const expected = await Promise.all(config.expectedFiles.map(file => resolveOnDisk(root, file)));
      const confined = confineRequired(root, config.expectedFiles, new Map(expected));
      if (confined.kind === 'refused') return refuse(confined);
      const required = confined.paths;
      temp = await mkdtemp(join(tmpdir(), 'redproof-coverage-py-'));
      const dataFile = join(temp, 'data'), reportFile = join(temp, 'coverage.json');
      // Ambient config that can silently change what is measured or where it is written is scrubbed; the explicit `rcfile` option is the only
      // config channel. PYTHONPATH, COVERAGE_CORE and the interpreter itself are deliberately left alone: the environment is trusted, not hostile.
      const scrubbed = { COVERAGE_RCFILE: undefined, COVERAGE_FILE: undefined, COVERAGE_PROCESS_START: undefined, COVERAGE_DEBUG: undefined, COVERAGE_DEBUG_FILE: undefined };
      const limits = { cwd, timeoutMs: config.timeoutMs, maxOutputBytes: config.maxOutputBytes, env: scrubbed };
      if (!config.rcfile) {
        const probe = await executeCommand({ command: config.python, args: probeArgs(), ...limits });
        const probed = producerOutcome('config probe', probe);
        if (probed) return refuse(probed);
        const exclusions = configExclusions(parseProjectConfig(probe.kind === 'completed' ? probe.stdout : ''), false, config.source.length > 0);
        if (exclusions) return refuse(exclusions);
      }
      const ran = producerOutcome('run', await executeCommand({ command: config.python, args: runArgs(config, dataFile, rcfile), ...limits }));
      if (ran) return refuse(ran);
      const reported = producerOutcome('json', await executeCommand({ command: config.python, args: jsonArgs(dataFile, reportFile, rcfile), ...limits }));
      if (reported) return refuse(reported);
      const stat = await lstat(reportFile);
      const untrusted = reportIdentity({ file: stat.isFile(), symlink: stat.isSymbolicLink(), size: stat.size }, config.maxReportBytes);
      if (untrusted) return refuse(untrusted);
      const evidence = parseCoveragePy(await readFile(reportFile, 'utf8'), root, cwd);
      const resolved = new Map(await Promise.all(evidence.files.map(file => resolveOnDisk(root, file.file))));
      const untrustedFiles = trustFiles(root, evidence, resolved);
      if (untrustedFiles) return refuse(untrustedFiles);
      const decision = decide(evidence, required, selected);
      if (decision.kind === 'refused') return refuse(decision.refusal);
      return result.fromBreaches(scan(startedAt, new Date().toISOString(), evidence.files.length), decision.breaches);
    } catch (error) {
      return refuse(unavailable(error instanceof Error ? error.message : String(error)));
    }
  })();
  if (temp) {
    try { await rm(temp, { recursive: true, force: true }); }
    catch (error) { if (outcome.verdict === 'pass') return refuse(cleanupUnavailable(String(error))); }
  }
  return outcome;
}
