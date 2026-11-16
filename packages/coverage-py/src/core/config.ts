import { unavailable, type Refusal } from './refusals.ts';

/** What coverage.py auto-discovered in the run directory and what it excludes beyond the defaults. */
export type ProjectConfig = { readonly files: readonly string[]; readonly omit: readonly string[]; readonly exclude: readonly string[] };

function strings(value: unknown, what: string): readonly string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error(`Invalid coverage.py config probe: ${what}.`);
  return value as string[];
}
/** The probe prints one JSON line; anything else (a warning, a crash) fails closed. */
export function parseProjectConfig(stdout: string): ProjectConfig {
  const line = stdout.trim().split('\n').at(-1) ?? '';
  const data = JSON.parse(line) as Record<string, unknown>;
  if (!data || typeof data !== 'object') throw new Error('Invalid coverage.py config probe output.');
  return { files: strings(data.files, 'files'), omit: strings(data.omit, 'omit'), exclude: strings(data.exclude, 'exclude') };
}
/**
 * Auto-discovered project config (.coveragerc, setup.cfg, tox.ini, pyproject.toml) that omits files or adds exclusion patterns shrinks
 * the denominator without any trust check noticing: the report's totals still agree. An explicit `rcfile` is the acknowledgement.
 */
export function configExclusions(config: ProjectConfig, rcfileExplicit: boolean): Refusal | null {
  if (rcfileExplicit || (!config.omit.length && !config.exclude.length)) return null;
  const parts = [...(config.omit.length ? [`omits ${config.omit.join(', ')}`] : []), ...(config.exclude.length ? [`adds exclusion patterns ${config.exclude.join(', ')}`] : [])];
  return { ...unavailable(`Auto-discovered coverage config (${config.files.join(', ')}) ${parts.join(' and ')}, which can hide uncovered code. `
    + 'Pass it explicitly as `rcfile` to accept it, or remove the exclusions.'), code: 'coverage-py-config-excludes' };
}
