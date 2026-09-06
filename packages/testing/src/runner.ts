import { spawn } from 'node:child_process';
import type { TestRunner, TestRunnerContext, TestRunnerResult } from './model.ts';

export type CommandArgs = readonly string[] | ((ctx: TestRunnerContext) => readonly string[]);

export type CommandRunnerOptions = {
  readonly command: string;
  readonly args?: CommandArgs;
  readonly env?: Readonly<Record<string, string>>;
  readonly description?: string;
};

function argsFor(args: CommandArgs | undefined, ctx: TestRunnerContext): readonly string[] {
  if (!args) return [];
  return typeof args === 'function' ? args(ctx) : args;
}

export function command(options: CommandRunnerOptions): TestRunner {
  return {
    description: options.description ?? `run ${options.command}`,

    async run(ctx): Promise<TestRunnerResult> {
      const args = argsFor(options.args, ctx);

      return new Promise(resolve => {
        const child = spawn(options.command, args, {
          cwd: ctx.root,
          env: {
            ...process.env,
            REDPROOF_TEST_REPORT: ctx.reportFile,
            ...options.env,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        child.stdout?.setEncoding('utf8');
        child.stderr?.setEncoding('utf8');
        child.stdout?.on('data', chunk => { stdout += chunk; });
        child.stderr?.on('data', chunk => { stderr += chunk; });

        child.once('error', error => {
          resolve({
            kind: 'unavailable',
            message: `Could not start test command ${options.command}.`,
            detail: error.message,
          });
        });

        child.once('close', (code, signal) => {
          if (signal) {
            const detail = stderr || stdout;
            resolve({
              kind: 'unavailable',
              message: `Test command ${options.command} was terminated by ${signal}.`,
              ...(detail ? { detail } : {}),
            });
            return;
          }

          resolve({
            kind: 'completed',
            exitCode: code ?? 1,
            stdout,
            stderr,
          });
        });
      });
    },
  };
}
