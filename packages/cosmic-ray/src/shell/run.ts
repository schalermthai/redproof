import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep, isAbsolute } from 'node:path';
import { result, type CheckContext, type CheckResult, type Scan } from 'redproof';
import { executeCommand, type CommandExecution, type CommandExecutionOptions } from 'redproof/command';
import { cosmicRayArgs, type CosmicRayConfig } from '../core/options.ts';
import { parseCosmicRayDump } from '../core/report.ts';
import { decideCosmicRayRun, type CosmicRayPolicies } from '../core/verdict.ts';

export type RunCommand = (options: CommandExecutionOptions) => Promise<CommandExecution>;

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
      const session = join(temp, 'session.sqlite');
      const limits = { cwd, timeoutMs: config.timeoutMs, maxOutputBytes: config.maxOutputBytes };

      const steps = ['baseline', 'init', 'exec', 'dump'] as const;
      let dump = '';
      for (const step of steps) {
        const execution = await runCommand({
          command: config.python,
          args: cosmicRayArgs(step, config.config, session),
          label: `cosmic-ray ${step}`,
          ...limits,
        });
        if (execution.kind === 'refused') {
          return refuse(execution.code, execution.message, execution.detail);
        }
        if (execution.exitCode !== 0) {
          // A failing baseline would make every mutant look killed, so it must never reach the score.
          const code = step === 'baseline' ? 'cosmic-ray-baseline-failed' : 'cosmic-ray-producer-unsuccessful';
          const message = step === 'baseline'
            ? 'The test suite fails on unmutated code, so every mutant would look killed.'
            : `cosmic-ray ${step} did not complete successfully.`;
          return refuse(code, message, `exit code: ${execution.exitCode}\n${execution.stderr}\n${execution.stdout}`.trim());
        }
        if (step === 'dump') dump = execution.stdout;
      }

      const mutants = parseCosmicRayDump(dump);
      if (mutants instanceof Error) {
        return refuse('cosmic-ray-report-invalid', 'The cosmic-ray dump could not be read.', mutants.message);
      }
      return decideCosmicRayRun({ scan: scan(startedAt, mutants.length), root, cwd, mutants, policies });
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
