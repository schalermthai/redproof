import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep, isAbsolute } from 'node:path';
import { result, type CheckContext, type CheckResult, type Scan } from 'redproof';
import { executeCommand, type CommandExecution, type CommandExecutionOptions, type CompletedCommand } from 'redproof/command';
import { firstEscapingModule, isInsideDirectory } from '../core/copy.ts';
import { classifyStepFailure, type CosmicRayStep, type StepFailure } from '../core/failure.ts';
import { copyProject } from './sandbox.ts';
import { cosmicRayArgs, type CosmicRayConfig } from '../core/options.ts';
import { jobsDiffer, parseCosmicRayDump } from '../core/report.ts';
import { decideCosmicRayRun, type CosmicRayPolicies } from '../core/verdict.ts';

export type RunCommand = (options: CommandExecutionOptions) => Promise<CommandExecution>;

/** The effects other than commands that a run needs; replaceable so the cleanup policy can be exercised. */
export type RunEffects = {
  readonly remove: (path: string) => Promise<void>;
  readonly now: () => number;
};

const realEffects: RunEffects = {
  remove: path => rm(path, { recursive: true, force: true }),
  now: () => Date.now(),
};

/**
 * After cosmic-ray was killed (deadline, abort) the test command it started is orphaned and runs on in a deleted sandbox. The driver
 * lists the process group of every test command that is still running; kill those groups before the sandbox goes.
 */
async function killLeftoverTestProcesses(temp: string): Promise<void> {
  const names = await readdir(join(temp, 'pgids')).catch(() => [] as string[]);
  for (const name of names) {
    const pid = Number(name);
    if (!Number.isInteger(pid) || pid <= 1) continue;
    try { process.kill(-pid, 'SIGKILL'); } catch { /* already gone */ }
  }
}

export const runCosmicRayCommand: RunCommand = executeCommand;

function scan(startedAt: string, inspected: number | null): Scan {
  return { source: 'cosmic-ray', startedAt, finishedAt: new Date().toISOString(), inspected };
}

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** Run baseline, init, exec and dump in a private session directory, then judge the dump. */
export async function runCosmicRayCheck<R extends string>(
  ctx: CheckContext<R>,
  config: CosmicRayConfig,
  policies: CosmicRayPolicies<R>,
  runCommand: RunCommand,
  effects: RunEffects = realEffects,
): Promise<CheckResult<R>> {
  const startedAt = new Date().toISOString();
  const refuse = (code: string, message: string, detail?: string, inspected: number | null = null) =>
    result.refuse(scan(startedAt, inspected), { code, message, location: null, ...(detail ? { detail } : {}) });
  let temp: string | undefined;

  const outcome = await (async (): Promise<CheckResult<R>> => {
    try {
      const root = await realpath(ctx.root);
      const cwd = await realpath(resolve(root, config.cwd));
      if (!inside(root, cwd)) {
        return refuse('cosmic-ray-cwd-outside-root', 'The cosmic-ray working directory resolves outside the Gate root.', cwd);
      }
      temp = await mkdtemp(join(tmpdir(), 'redproof-cosmic-ray-'));
      // cosmic-ray rewrites source files in place and a kill (timeout, abort) leaves them mutated, so every step runs on a copy.
      const sandbox = join(temp, 'project');
      const copied = await copyProject(root, sandbox, config.maxCopyBytes, config.maxCopyEntries);
      if (copied.kind === 'collision') {
        return refuse('cosmic-ray-copy-collision', 'Two files in the project share one name in the sandbox (names that differ only by case on a case-insensitive disk).', copied.path);
      }
      if (copied.kind === 'too-large') {
        return refuse('cosmic-ray-copy-too-large', 'The project is too large to copy for a mutation run.',
          `Over ${config.maxCopyBytes} bytes or ${config.maxCopyEntries} entries (seen ${copied.bytes} bytes, ${copied.entries} entries). Raise maxCopyBytes or maxCopyEntries, or point cwd at a smaller project.`);
      }
      const sandboxCwd = join(sandbox, relative(root, cwd));
      const session = join(temp, 'session.sqlite');
      // One deadline for the whole run: each step gets what is left of timeoutMs.
      const deadline = effects.now() + config.timeoutMs;

      const run = async (step: CosmicRayStep): Promise<CommandExecution | StepFailure> => {
        const remaining = deadline - effects.now();
        if (remaining <= 0) {
          return { code: 'command-timeout', message: `The cosmic-ray run used up its timeoutMs of ${config.timeoutMs} before ${step}.` };
        }
        const execution = await runCommand({
          command: config.python,
          args: cosmicRayArgs(step, config.config, session),
          label: `cosmic-ray ${step}`,
          cwd: sandboxCwd,
          timeoutMs: remaining,
          maxOutputBytes: config.maxOutputBytes,
          env: { REDPROOF_PGIDS: join(temp as string, 'pgids') },
        });
        if (execution.kind === 'refused') return { code: execution.code, message: execution.message, detail: execution.detail };
        return execution.exitCode === 0 ? execution : classifyStepFailure(step, execution.exitCode, execution.stdout, execution.stderr);
      };

      for (const step of ['baseline', 'init'] as const) {
        const done = await run(step);
        if ('code' in done) return refuse(done.code, done.message, done.detail);
      }
      // Before anything is mutated: a module path that leaves the copy would be mutated in the real project.
      const planned = await run('dump');
      if ('code' in planned) return refuse(planned.code, planned.message, planned.detail);
      const items = parseCosmicRayDump((planned as CompletedCommand).stdout);
      if (items instanceof Error) {
        return refuse('cosmic-ray-report-invalid', 'The cosmic-ray dump could not be read.', items.message);
      }
      const escaping = firstEscapingModule(items);
      if (escaping) {
        return refuse('cosmic-ray-module-path-escapes', 'A module path is absolute, so it would be mutated outside the sandbox.', escaping.modulePath);
      }
      // The spelling can look innocent while a link leads out of the copy (a linked environment, a link that survived the copy).
      const sandboxReal = await realpath(sandbox);
      for (const item of items) {
        const resolved = await realpath(join(sandboxCwd, item.modulePath)).catch(() => null);
        if (resolved === null || !isInsideDirectory(sandboxReal, resolved)) {
          return refuse('cosmic-ray-module-path-escapes', 'A module path resolves outside the sandbox through a link, or does not exist there, so it would be mutated outside the sandbox.', item.modulePath);
        }
      }
      const executed = await run('exec');
      if ('code' in executed) return refuse(executed.code, executed.message, executed.detail);
      const dumped = await run('dump');
      if ('code' in dumped) return refuse(dumped.code, dumped.message, dumped.detail);
      const dump = (dumped as CompletedCommand).stdout;

      const mutants = parseCosmicRayDump(dump);
      if (mutants instanceof Error) {
        return refuse('cosmic-ray-report-invalid', 'The cosmic-ray dump could not be read.', mutants.message);
      }
      if (jobsDiffer(items, mutants)) {
        return refuse('cosmic-ray-report-invalid', 'The final dump does not describe the jobs that were planned.', `${items.length} planned, ${mutants.length} in the final dump.`);
      }
      return decideCosmicRayRun({ scan: scan(startedAt, mutants.length), root, cwd, mutants, timeouts: config.timeouts, policies });
    } catch (error) {
      return refuse('cosmic-ray-unavailable', 'cosmic-ray could not complete the mutation check.',
        error instanceof Error ? error.message : String(error));
    }
  })();

  if (!temp) return outcome;
  // Error precedence: the check's own outcome wins. A cleanup failure demotes only a PASS (never a pass that left 500 MiB behind);
  // a REFUSE keeps its code and gains the leaked path in its detail; a FAIL keeps its breaches unchanged.
  try {
    await killLeftoverTestProcesses(temp);
    await effects.remove(temp);
    return outcome;
  } catch (error) {
    const leaked = `Could not remove ${temp}: ${error instanceof Error ? error.message : String(error)}`;
    if (outcome.verdict === 'pass') return refuse('cosmic-ray-cleanup-unavailable', 'Could not clean up the sandbox copy.', leaked);
    if (outcome.verdict === 'refuse') {
      return result.refuse(outcome.scan, { ...outcome.why, detail: [outcome.why.detail, leaked].filter(Boolean).join('\n') });
    }
    // A FAIL keeps its breaches, and the first one names what was left behind.
    const [first, ...rest] = outcome.breaches;
    return result.fail(outcome.scan, [{ ...first, detail: [first.detail, leaked].filter(Boolean).join('\n') }, ...rest]);
  }
}
