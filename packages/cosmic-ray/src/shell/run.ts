import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep, isAbsolute } from 'node:path';
import { result, type CheckContext, type CheckResult, type Scan } from 'redproof';
import { executeCommand, type CommandExecution, type CommandExecutionOptions, type CompletedCommand } from 'redproof/command';
import { escapesCopy } from '../core/copy.ts';
import { copyProject } from './sandbox.ts';
import { cosmicRayArgs, type CosmicRayConfig } from '../core/options.ts';
import { parseCosmicRayDump } from '../core/report.ts';
import { decideCosmicRayRun, type CosmicRayPolicies } from '../core/verdict.ts';

export type RunCommand = (options: CommandExecutionOptions) => Promise<CommandExecution>;

export const runCosmicRayCommand: RunCommand = executeCommand;

function scan(startedAt: string, inspected: number | null): Scan {
  return { source: 'cosmic-ray', startedAt, finishedAt: new Date().toISOString(), inspected };
}

type Failure = { readonly code: string; readonly message: string; readonly detail?: string | undefined };

/** Name what went wrong with a step that exited non-zero, without blaming the tests for a tool or config problem. */
function failure(step: string, execution: CompletedCommand): Failure {
  const output = `exit code: ${execution.exitCode}\n${execution.stderr}\n${execution.stdout}`.trim();
  if (/No module named '?cosmic_ray/u.test(output)) {
    return { code: 'cosmic-ray-not-installed', message: 'The Python interpreter has no cosmic-ray installed.', detail: output };
  }
  if (execution.exitCode === 78) {
    return { code: 'cosmic-ray-config-invalid', message: 'cosmic-ray could not load its configuration.', detail: output };
  }
  if (step === 'baseline' && execution.exitCode === 1 && /Baseline failed/u.test(output)) {
    return { code: 'cosmic-ray-baseline-failed', message: 'The test suite fails on unmutated code, so every mutant would look killed.', detail: output };
  }
  return { code: 'cosmic-ray-producer-unsuccessful', message: `cosmic-ray ${step} did not complete successfully.`, detail: output };
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
      const copied = await copyProject(root, sandbox, config.maxCopyBytes);
      if (copied.kind === 'too-large') {
        return refuse('cosmic-ray-copy-too-large', 'The project is too large to copy for a mutation run.',
          `More than ${config.maxCopyBytes} bytes. Raise maxCopyBytes or point cwd at a smaller project.`);
      }
      const sandboxCwd = join(sandbox, relative(root, cwd));
      const session = join(temp, 'session.sqlite');
      const limits = { cwd: sandboxCwd, timeoutMs: config.timeoutMs, maxOutputBytes: config.maxOutputBytes };

      const run = async (step: 'baseline' | 'init' | 'exec' | 'dump'): Promise<CommandExecution | Failure> => {
        const execution = await runCommand({
          command: config.python,
          args: cosmicRayArgs(step, config.config, session),
          label: `cosmic-ray ${step}`,
          ...limits,
        });
        if (execution.kind === 'refused') return { code: execution.code, message: execution.message, detail: execution.detail };
        return execution.exitCode === 0 ? execution : failure(step, execution);
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
      const escaping = items.find(item => escapesCopy(item.modulePath));
      if (escaping) {
        return refuse('cosmic-ray-module-path-escapes', 'A module path is absolute or outside the working directory, so it would be mutated outside the sandbox.', escaping.modulePath);
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
      return decideCosmicRayRun({ scan: scan(startedAt, mutants.length), root, cwd, mutants, timeouts: config.timeouts, policies });
    } catch (error) {
      return refuse('cosmic-ray-unavailable', 'cosmic-ray could not complete the mutation check.',
        error instanceof Error ? error.message : String(error));
    }
  })();

  if (temp) {
    try {
      await rm(temp, { recursive: true, force: true });
    } catch (error) {
      if (outcome.verdict === 'pass') {
        return refuse('cosmic-ray-cleanup-unavailable', 'Could not clean up the private cosmic-ray session.', String(error));
      }
    }
  }
  return outcome;
}
