import { rejectUnknownKeys } from 'redproof';
import type { TestRuleOptions } from './model.ts';
import { validateRelativeTestingPath } from './paths.ts';

export type VitestAdapterOptions<O extends TestRuleOptions> = {
  readonly command?: string;
  /** Relative to the Gate root and confined inside it. Defaults to the root. */
  readonly cwd?: string;
  readonly configFile?: string;
  /** A JSON output file configured in Vitest, relative to cwd. */
  readonly reportFile?: string;
  readonly files?: readonly string[];
  readonly args?: readonly string[];
  readonly timeoutMs?: number;
  /** Combined stdout and stderr capture limit. Defaults to 10 MiB. */
  readonly maxOutputBytes?: number;
  readonly rules: O;
};

export function validateVitestOptions(options: VitestAdapterOptions<TestRuleOptions>): void {
  rejectUnknownKeys(
    options,
    [
      'command',
      'cwd',
      'configFile',
      'reportFile',
      'files',
      'args',
      'timeoutMs',
      'maxOutputBytes',
      'rules',
    ],
    'Vitest adapter',
  );
  for (const [name, path] of [
    ['cwd', options.cwd],
    ['configFile', options.configFile],
    ['reportFile', options.reportFile],
  ] as const) {
    if (path !== undefined) validateRelativeTestingPath(name, path);
  }
  for (const [index, file] of (options.files ?? []).entries()) {
    validateRelativeTestingPath(`files[${index}]`, file);
  }
}

/** Run flags, then the private report file unless one is configured, config, extra args, files. */
export function vitestArgs(options: VitestAdapterOptions<TestRuleOptions>, reportFile: string): readonly string[] {
  return [
    'run',
    '--reporter=json',
    '--no-cache',
    ...(options.reportFile !== undefined ? [] : [`--outputFile=${reportFile}`]),
    ...(options.configFile ? ['--config', options.configFile] : []),
    ...(options.args ?? []),
    ...(options.files ?? []),
  ];
}
