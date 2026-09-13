import { readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { coveragePath } from '../core/model.ts';
import type { CoverageContext } from '../core/options.ts';
import { nycArgs, supportedNycVersion, type PlannedCommand, type Refusal } from '../core/report.ts';

export type NycPlanInputs = {
  readonly command: string;
  readonly args: readonly string[];
  readonly configFile: string | undefined;
  readonly include: readonly string[];
  readonly exclude: readonly string[];
  readonly all: boolean;
};

export function nycPlan(inputs: NycPlanInputs): (context: CoverageContext) => Promise<PlannedCommand | Refusal> {
  return async context => {
    const require = createRequire(join(context.cwd, 'package.json'));
    const unsupported = supportedNycVersion(await readFile(require.resolve('nyc/package.json'), 'utf8'));
    if (unsupported) return unsupported;
    const config = inputs.configFile ? await realpath(resolve(context.root, inputs.configFile)) : undefined;
    if (config) coveragePath(context.root, config);
    return { kind: 'planned', command: process.execPath, args: nycArgs({ script: require.resolve('nyc/bin/nyc.js'),
      cwd: context.cwd, config, include: inputs.include, exclude: inputs.exclude,
      reportDirectory: context.reportDirectory, tempDirectory: context.tempDirectory,
      all: inputs.all, command: inputs.command, args: inputs.args }) };
  };
}
