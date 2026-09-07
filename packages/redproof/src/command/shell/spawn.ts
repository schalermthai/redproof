import { spawn } from 'node:child_process';
import type { RuleRef } from '../../domain/rule.ts';
import type { CommandCheckOptions } from '../core/options.ts';
import { outputDetail, type CommandExecution } from '../core/outcome.ts';

const FORCE_KILL_AFTER_MS = 250;

export function executeCommand(
  options: CommandCheckOptions<RuleRef>,
  cwd: string,
  maxOutputBytes: number,
): Promise<CommandExecution> {
  return new Promise(resolveExecution => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(options.command, options.args ?? [], {
        cwd,
        env: { ...process.env, ...options.env },
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
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

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let capturedBytes = 0;
    let settled = false;
    let interruption: 'timeout' | 'output-limit' | undefined;
    let timeout: NodeJS.Timeout | undefined;
    let forceKill: NodeJS.Timeout | undefined;

    const captured = () => ({
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    });

    const settle = (outcome: CommandExecution): void => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (forceKill) clearTimeout(forceKill);
      resolveExecution(outcome);
    };

    const interrupt = (reason: 'timeout' | 'output-limit'): void => {
      if (interruption) return;
      interruption = reason;
      child.kill();
      forceKill = setTimeout(() => child.kill('SIGKILL'), FORCE_KILL_AFTER_MS);
      forceKill.unref();
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
      if (interruption) return;
      settle({
        kind: 'refused',
        code: 'command-unavailable',
        message: `Could not start ${options.label ?? options.command}.`,
        detail: error.message,
      });
    });

    child.once('close', (code, signal) => {
      const output = captured();
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
