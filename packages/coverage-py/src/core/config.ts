import { unavailable, type Refusal } from './refusals.ts';

/** What coverage.py auto-discovered in the run directory, what it excludes beyond the defaults, and what it restricts the report to. */
export type ProjectConfig = {
  readonly files: readonly string[]; readonly omit: readonly string[]; readonly exclude: readonly string[]; readonly include: readonly string[];
  readonly source: readonly string[]; readonly plugins: readonly string[];
  readonly ignoreErrors: boolean;
};

function strings(value: unknown, what: string): readonly string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error(`Invalid coverage.py config probe: ${what}.`);
  return value as string[];
}
function boolean(value: unknown, what: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Invalid coverage.py config probe: ${what}.`);
  return value;
}
/** The probe prints one JSON line; anything else (a warning, a crash) fails closed. */
export function parseProjectConfig(stdout: string): ProjectConfig {
  const line = stdout.trim().split('\n').at(-1) ?? '';
  const data = JSON.parse(line) as Record<string, unknown>;
  if (!data || typeof data !== 'object') throw new Error('Invalid coverage.py config probe output.');
  return { files: strings(data.files, 'files'), omit: strings(data.omit, 'omit'), exclude: strings(data.exclude, 'exclude'), include: strings(data.include, 'include'),
    source: strings(data.source, 'source'), plugins: strings(data.plugins, 'plugins'),
    ignoreErrors: boolean(data.ignoreErrors, 'ignoreErrors') };
}
/**
 * Auto-discovered project config (.coveragerc, setup.cfg, tox.ini, pyproject.toml) can shrink or rewrite what is judged without any trust
 * check noticing, because the report's totals still agree: `omit`, extra exclusion patterns, an `include` list, `source`/`source_pkgs`
 * (unless the adapter's own `source` option is set: coverage.py unions it with them), and plugins (a configurer can rewrite any option
 * after the probe reads it), and `ignore_errors` (an unparseable source file silently leaves the report instead of failing it).
 * An explicit `rcfile` is the acknowledgement.
 */
export function configExclusions(config: ProjectConfig, rcfileExplicit: boolean, sourceExplicit: boolean): Refusal | null {
  const sourceNarrows = config.source.length > 0 && !sourceExplicit;
  if (rcfileExplicit || (!config.omit.length && !config.exclude.length && !config.include.length && !sourceNarrows && !config.plugins.length && !config.ignoreErrors)) return null;
  const parts = [
    ...(config.omit.length ? [`omits ${config.omit.join(', ')}`] : []),
    ...(config.exclude.length ? [`adds exclusion patterns ${config.exclude.join(', ')}`] : []),
    ...(config.include.length ? [`restricts the report to ${config.include.join(', ')}`] : []),
    ...(sourceNarrows ? [`measures only ${config.source.join(', ')} (set the adapter's \`source\` option to measure explicitly)`] : []),
    ...(config.plugins.length ? [`loads plugins ${config.plugins.join(', ')}, which can change what is measured`] : []),
    ...(config.ignoreErrors ? ['sets ignore_errors, so an unparseable source file would silently leave the report'] : []),
  ];
  return { ...unavailable(`Auto-discovered coverage config (${config.files.join(', ')}) ${parts.join(' and ')}, which can hide uncovered code. `
    + 'Pass it explicitly as `rcfile` to accept it, or remove the exclusions.'), code: 'coverage-py-config-excludes' };
}
