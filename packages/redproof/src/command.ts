import { spawn } from 'node:child_process';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { breach, counting, result } from './composition/check.ts';
import type { Check, CheckResult, Scan } from './domain/check.ts';
import type { Rule, RuleRef } from './domain/rule.ts';

const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const FORCE_KILL_AFTER_MS = 250;

export type CommandExitCodes = {
  /** Exit codes that produce PASS. Defaults to `[0]`. */
  readonly pass?: readonly number[];
  /** Exit codes that breach the Rule. Defaults to every nonzero code not classified as PASS. */
  readonly breach?: readonly number[] | 'nonzero';
};

export type CommandCheckOptions<R extends RuleRef> = {
  readonly rule: Rule<R>;
  readonly command: string;
  readonly args?: readonly string[];
  readonly label?: string;
  readonly description?: string;
  /** Relative to the Gate root and confined inside it. Defaults to the root. */
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly timeoutMs?: number;
  /** Combined stdout and stderr capture limit. Defaults to 10 MiB. */
  readonly maxOutputBytes?: number;
  readonly exitCodes?: CommandExitCodes;
};

type CompletedCommand = {
  readonly kind: 'completed';
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

type RefusedCommand = {
  readonly kind: 'refused';
  readonly code:
    | 'command-unavailable'
    | 'command-timeout'
    | 'command-signaled'
    | 'command-output-limit';
  readonly message: string;
  readonly detail?: string;
};

type CommandExecution = CompletedCommand | RefusedCommand;

type NormalizedExitCodes = {
  readonly pass: ReadonlySet<number>;
  readonly breach: ReadonlySet<number> | 'nonzero';
};

function validatePositiveInteger(name: string, value: number | undefined): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
    throw new Error(`${name} must be a positive integer.`);
  }
}

function validateExitCode(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must contain only non-negative integers.`);
  }
}

function normalizeExitCodes(options: CommandExitCodes | undefined): NormalizedExitCodes {
  const passCodes = options?.pass ?? [0];
  const breachCodes = options?.breach ?? 'nonzero';

  for (const code of passCodes) validateExitCode('exitCodes.pass', code);
  if (breachCodes !== 'nonzero') {
    for (const code of breachCodes) validateExitCode('exitCodes.breach', code);
  }

  const pass = new Set(passCodes);
  if (breachCodes !== 'nonzero') {
    for (const code of breachCodes) {
      if (pass.has(code)) {
        throw new Error(`Exit code ${code} cannot produce both PASS and a Breach.`);
      }
    }
  }

  return {
    pass,
    breach: breachCodes === 'nonzero' ? breachCodes : new Set(breachCodes),
  };
}

function outputDetail(stdout: string, stderr: string, prefix?: string): string | undefined {
  const sections = [
    prefix,
    stdout ? `stdout:\n${stdout}` : undefined,
    stderr ? `stderr:\n${stderr}` : undefined,
  ].filter((section): section is string => section !== undefined);
  return sections.length > 0 ? sections.join('\n\n') : undefined;
}

function executeCommand(
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

function isInsideRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function scan(source: string, startedAt: string): Scan {
  return {
    source,
    startedAt,
    finishedAt: new Date().toISOString(),
    inspected: 1,
  };
}

/** Create a Check that maps one executable invocation to PASS, a targeted Breach, or REFUSE. */
export function command<const R extends RuleRef>(options: CommandCheckOptions<R>): Check<R> {
  if (!options.command.trim()) throw new Error('command must not be empty.');
  validatePositiveInteger('timeoutMs', options.timeoutMs);
  validatePositiveInteger('maxOutputBytes', options.maxOutputBytes);

  const exitCodes = normalizeExitCodes(options.exitCodes);
  const label = options.label ?? options.command;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  return {
    description: options.description ?? `run ${label}`,
    counting: counting.supported,

    async run(ctx): Promise<CheckResult<R>> {
      const startedAt = new Date().toISOString();
      const root = resolve(ctx.root);
      const cwd = resolve(root, options.cwd ?? '.');
      if (!isInsideRoot(root, cwd)) {
        return result.refuse(scan(label, startedAt), {
          code: 'command-cwd-outside-root',
          message: `The working directory for ${label} resolves outside the Gate root.`,
          location: null,
          detail: cwd,
        });
      }

      const execution = await executeCommand(options, cwd, maxOutputBytes);
      const completedScan = scan(label, startedAt);
      if (execution.kind === 'refused') {
        return result.refuse(completedScan, {
          code: execution.code,
          message: execution.message,
          location: null,
          ...(execution.detail ? { detail: execution.detail } : {}),
        });
      }

      if (exitCodes.pass.has(execution.exitCode)) return result.pass(completedScan);

      const isBreach = exitCodes.breach === 'nonzero'
        ? execution.exitCode !== 0
        : exitCodes.breach.has(execution.exitCode);
      const detail = outputDetail(
        execution.stdout,
        execution.stderr,
        `exit code: ${execution.exitCode}`,
      );

      if (isBreach) {
        return result.fail(completedScan, [
          breach(options.rule, {
            code: 'command-exit',
            message: `${label} exited with code ${execution.exitCode}.`,
            location: null,
            ...(detail ? { detail } : {}),
          }),
        ]);
      }

      return result.refuse(completedScan, {
        code: 'command-exit-unclassified',
        message: `${label} exited with unclassified code ${execution.exitCode}.`,
        location: null,
        ...(detail ? { detail } : {}),
      });
    },
  };
}
