import { counting, defineAdapter, rejectUnknownKeys, type Adapter, type NoUnknownKeys } from 'redproof';
import type { CoverageCatalog, CoverageRules } from './core/model.ts';
import { catalog, commonKeys, resolveConfig, validate, validateNycOptions,
  type CommonOptions, type ExactRules, type IstanbulOptions, type NycOptions } from './core/options.ts';
import { collect, type Plan } from './shell/collect.ts';
import { nycPlan } from './shell/nyc.ts';

export type { CoverageContext, IstanbulOptions, NycOptions } from './core/options.ts';
export type { CoverageRules, CoverageCatalog, Threshold } from './core/model.ts';

function adapter<R extends CoverageRules>(options: CommonOptions<R>, plan: Plan): Adapter<CoverageCatalog<R>> {
  const { rules, selected } = catalog(options.rules);
  const config = resolveConfig(options);
  return defineAdapter({ kind: 'istanbul', rules, check: {
    description: 'collect fresh Istanbul coverage and evaluate selected thresholds', counting: counting.supported,
    run: ctx => collect(ctx, config, selected, plan),
  } });
}

export function istanbul<const O extends IstanbulOptions>(options: O & NoUnknownKeys<O, IstanbulOptions> & { readonly rules: ExactRules<O['rules']> }): Adapter<CoverageCatalog<O['rules']>> {
  rejectUnknownKeys(options, [...commonKeys, 'command', 'args'], 'Istanbul adapter');
  validate(options);
  if (typeof options.args !== 'function') throw new Error('Istanbul args must be a report-context function.');
  const command = options.command, args = options.args;
  return adapter(options, async context => ({ kind: 'planned', command, args: args(context) }));
}

export function nyc<const O extends NycOptions>(options: O & NoUnknownKeys<O, NycOptions> & { readonly rules: ExactRules<O['rules']> }): Adapter<CoverageCatalog<O['rules']>> {
  rejectUnknownKeys(options, [...commonKeys, 'command', 'args', 'configFile', 'include', 'exclude', 'all'], 'nyc adapter');
  validate(options);
  validateNycOptions(options);
  return adapter(options, nycPlan({ command: options.command, args: [...(options.args ?? [])], all: options.all ?? true,
    include: [...(options.include ?? [])], exclude: [...(options.exclude ?? [])], configFile: options.configFile }));
}
