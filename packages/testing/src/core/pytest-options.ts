import { rejectUnknownKeys } from 'redproof';
import type { TestRuleOptions } from './model.ts';
import { validateRelativeTestingPath } from './paths.ts';

/** The Rules pytest's JUnit XML can support. It cannot show retries or TODO tests. */
export type PytestRuleOptions = Pick<TestRuleOptions, 'testsPass' | 'noSkippedTests' | 'noXfailTests'>;

export type PytestAdapterOptions<O extends PytestRuleOptions> = {
  readonly command?: string;
  /** Relative to the Gate root and confined inside it. Defaults to the root. */
  readonly cwd?: string;
  /** Test files or node ids, relative to cwd. Defaults to pytest's own collection. */
  readonly files?: readonly string[];
  readonly args?: readonly string[];
  readonly timeoutMs?: number;
  /** Combined stdout and stderr capture limit. Defaults to 10 MiB. */
  readonly maxOutputBytes?: number;
  readonly rules: O;
};

export function validatePytestOptions(options: PytestAdapterOptions<PytestRuleOptions>): void {
  rejectUnknownKeys(
    options,
    ['command', 'cwd', 'files', 'args', 'timeoutMs', 'maxOutputBytes', 'rules'],
    'pytest adapter',
  );
  if (options.cwd !== undefined) validateRelativeTestingPath('cwd', options.cwd);
  for (const [index, file] of (options.files ?? []).entries()) {
    validateRelativeTestingPath(`files[${index}]`, file);
  }
}

/**
 * Quiet output and a private JUnit file in the xunit1 family, which is the one that records each
 * test's file and line (xunit2 omits both). Then extra args, so a user's own `-o junit_family=...`
 * wins and locations simply become null. Then files.
 */
export function pytestArgs(options: PytestAdapterOptions<PytestRuleOptions>, reportFile: string): readonly string[] {
  return [
    '-q',
    `--junitxml=${reportFile}`,
    '-o',
    'junit_family=xunit1',
    ...(options.args ?? []),
    ...(options.files ?? []),
  ];
}
