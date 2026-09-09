import { spawn } from 'node:child_process';
import {
  DEFAULT_MAX_OUTPUT_BYTES,
  validateCommandExecutionOptions,
  type CommandExecutionOptions,
} from '../core/options.ts';
import { outputDetail, type CommandExecution } from '../core/outcome.ts';
import { superviseProcessTree, terminateProcessTree } from './process-tree.ts';

/** After a normal exit, how long the pipes may stay open before the rest of the group is stopped. */
export const PIPE_RELEASE_GRACE_MS = 250;

export function executeCommand(options: CommandExecutionOptions): Promise<CommandExecution> {
  validateCommandExecutionOptions(options);
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  return new Promise(resolveExecution => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(options.command, options.args ?? [], {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      });
    } catch (error) {
      resolveExecution({
        kind: 'refused',
        code: 'command-unavailable',
        message: `Could not start ${options.label ?? options.command}.`,
        detail: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    const releaseProcessTree = superviseProcessTree(child);

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let capturedBytes = 0;
    let settled = false;
    let interruption: 'timeout' | 'output-limit' | undefined;
    let timeout: NodeJS.Timeout | undefined;
    let termination: Promise<void> | undefined;

    const captured = () => ({
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    });

    const clearExecutionTimeout = (): void => {
      if (timeout) clearTimeout(timeout);
      timeout = undefined;
    };

    const settle = (outcome: CommandExecution): void => {
      if (settled) return;
      settled = true;
      clearExecutionTimeout();
      releaseProcessTree();
      resolveExecution(outcome);
    };

    const releasePipes = (): void => {
      child.stdout?.destroy();
      child.stderr?.destroy();
    };

    const terminate = (): Promise<void> =>
      terminateProcessTree(child).then(releasePipes, releasePipes);

    const interrupt = (reason: 'timeout' | 'output-limit'): void => {
      if (interruption || termination) return;
      interruption = reason;
      termination = terminate();
    };

    const capture = (target: Buffer[], chunk: Buffer | string): void => {
      if (interruption) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = Math.max(0, maxOutputBytes - capturedBytes);
      if (remaining > 0) target.push(buffer.subarray(0, remaining));
      capturedBytes += buffer.length;
      if (capturedBytes > maxOutputBytes) interrupt('output-limit');
    };

    child.stdout?.on('data', chunk => capture(stdout, chunk));
    child.stderr?.on('data', chunk => capture(stderr, chunk));

    child.once('error', error => {
      if (interruption || termination) return;
      settle({
        kind: 'refused',
        code: 'command-unavailable',
        message: `Could not start ${options.label ?? options.command}.`,
        detail: error.message,
      });
    });

    child.once('exit', (_, signal) => {
      clearExecutionTimeout();
      if (interruption) return;
      if (signal) {
        termination ??= terminate();
        return;
      }
      const grace = setTimeout(() => { termination ??= terminate(); }, PIPE_RELEASE_GRACE_MS);
      grace.unref();
      child.once('close', () => clearTimeout(grace));
    });

    child.once('close', async (code, signal) => {
      const output = captured();
      if (termination) await termination;
      if (interruption === 'timeout') {
        const detail = outputDetail(output.stdout, output.stderr);
        settle({
          kind: 'refused',
          code: 'command-timeout',
          message: `${options.label ?? options.command} exceeded its ${options.timeoutMs}ms timeout.`,
          ...(detail ? { detail } : {}),
        });
        return;
      }
      if (interruption === 'output-limit') {
        const detail = outputDetail(output.stdout, output.stderr);
        settle({
          kind: 'refused',
          code: 'command-output-limit',
          message: `${options.label ?? options.command} exceeded the ${maxOutputBytes}-byte output limit.`,
          ...(detail ? { detail } : {}),
        });
        return;
      }
      if (signal) {
        const detail = outputDetail(output.stdout, output.stderr);
        settle({
          kind: 'refused',
          code: 'command-signaled',
          message: `${options.label ?? options.command} was terminated by ${signal}.`,
          ...(detail ? { detail } : {}),
        });
        return;
      }

      settle({
        kind: 'completed',
        exitCode: code ?? 1,
        ...output,
      });
    });

    if (options.timeoutMs !== undefined) {
      timeout = setTimeout(() => interrupt('timeout'), options.timeoutMs);
      timeout.unref();
    }
  });
}
