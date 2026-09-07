import { isAbsolute, relative, sep } from 'node:path';
import { breach, result } from '../../composition/core/index.ts';
import type { CheckResult, Scan, Rule, RuleRef } from '../../domain/index.ts';
import { classifyExit, type ExitPolicy } from './exit-codes.ts';

export type CompletedCommand = {
  readonly kind: 'completed';
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

export type RefusedCommand = {
  readonly kind: 'refused';
  readonly code:
    | 'command-unavailable'
    | 'command-timeout'
    | 'command-signaled'
    | 'command-output-limit';
  readonly message: string;
  readonly detail?: string;
};

export type CommandExecution = CompletedCommand | RefusedCommand;

export function outputDetail(stdout: string, stderr: string, prefix?: string): string | undefined {
  const sections = [
    prefix,
    stdout ? `stdout:\n${stdout}` : undefined,
    stderr ? `stderr:\n${stderr}` : undefined,
  ].filter((section): section is string => section !== undefined);
  return sections.length > 0 ? sections.join('\n\n') : undefined;
}

/** Both paths must be absolute. */
export function isInsideRoot(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export function commandScan(source: string, startedAt: string, finishedAt: string, inspected: number): Scan {
  return { source, startedAt, finishedAt, inspected };
}

export function cwdOutsideRoot<R extends RuleRef>(scan: Scan, label: string, cwd: string): CheckResult<R> {
  return result.refuse(scan, {
    code: 'command-cwd-outside-root',
    message: `The working directory for ${label} resolves outside the Gate root.`,
    location: null,
    detail: cwd,
  });
}

/** Map what one process did to PASS, a targeted Breach, or REFUSE. */
export function commandResult<R extends RuleRef>(
  rule: Rule<R>,
  label: string,
  policy: ExitPolicy,
  execution: CommandExecution,
  scan: Scan,
): CheckResult<R> {
  if (execution.kind === 'refused') {
    return result.refuse(scan, {
      code: execution.code,
      message: execution.message,
      location: null,
      ...(execution.detail ? { detail: execution.detail } : {}),
    });
  }

  const exitClass = classifyExit(execution.exitCode, policy);
  if (exitClass === 'pass') return result.pass(scan);

  const detail = outputDetail(execution.stdout, execution.stderr, `exit code: ${execution.exitCode}`);
  if (exitClass === 'breach') {
    return result.fail(scan, [
      breach(rule, {
        code: 'command-exit',
        message: `${label} exited with code ${execution.exitCode}.`,
        location: null,
        ...(detail ? { detail } : {}),
      }),
    ]);
  }

  return result.refuse(scan, {
    code: 'command-exit-unclassified',
    message: `${label} exited with unclassified code ${execution.exitCode}.`,
    location: null,
    ...(detail ? { detail } : {}),
  });
}

/** The first REFUSE wins. Otherwise every Breach is carried in declaration order. */
export function aggregateResults<R extends RuleRef>(
  outcomes: readonly CheckResult<R>[],
  scan: Scan,
): CheckResult<R> {
  const refused = outcomes.find(outcome => outcome.verdict === 'refuse');
  if (refused?.verdict === 'refuse') return result.refuse(scan, refused.why);

  const breaches = outcomes.flatMap(outcome => outcome.verdict === 'fail' ? outcome.breaches : []);
  return result.fromBreaches(scan, breaches);
}
