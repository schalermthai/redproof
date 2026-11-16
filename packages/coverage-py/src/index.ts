import { counting, defineAdapter, rejectUnknownKeys, type Adapter, type NoUnknownKeys } from 'redproof';
import type { CoveragePyCatalog, CoveragePyRules } from './core/rules.ts';
import { catalog, optionKeys, resolveConfig, validate, type CoveragePyOptions, type ExactRules } from './core/options.ts';
import { collect } from './shell/collect.ts';

export type { CoveragePyOptions } from './core/options.ts';
export type { CoveragePyRules, CoveragePyCatalog, Threshold, FileThreshold } from './core/rules.ts';

/** Run `python -m coverage run … <args>`, then `coverage json`, and evaluate the selected rules on the format-3 report. */
export function coveragePy<const O extends CoveragePyOptions>(options: O & NoUnknownKeys<O, CoveragePyOptions> & { readonly rules: ExactRules<O['rules']> }): Adapter<CoveragePyCatalog<O['rules']>> {
  rejectUnknownKeys(options, optionKeys, 'coverage.py adapter');
  validate(options as CoveragePyOptions<CoveragePyRules>);
  const { rules, selected } = catalog(options.rules);
  const config = resolveConfig(options);
  return defineAdapter({ kind: 'coverage-py', rules, check: {
    description: 'collect fresh coverage.py JSON evidence and evaluate selected coverage rules', counting: counting.supported,
    run: ctx => collect(ctx, config, selected),
  } });
}
