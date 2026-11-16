export type ArgvPlan = { readonly args: readonly string[]; readonly branch: boolean; readonly source: readonly string[] };

/**
 * Start coverage the way its own console script does: without the current directory on sys.path, so a project's `json.py` or
 * `coverage.py` cannot shadow the tool. (`python -P` would also hide the project from the measured program, which then cannot
 * import its own sibling modules; this only changes how the tool starts.) coverage.py adds the program's own paths itself, but only when
 * sys.path[0] is not a directory, so the cwd entry is replaced by a placeholder: popping it would promote the first PYTHONPATH entry into
 * that slot and the program would lose its own directory whenever PYTHONPATH is set.
 */
const BOOTSTRAP = 'import sys\nif sys.path and sys.path[0] == "": sys.path[0] = "/nonexistent-redproof"\nfrom coverage.cmdline import main\nsys.exit(main())';
/** `coverage run --data-file=… [--branch] [--source=…] [--rcfile=…] <args>`. */
export function runArgs(plan: ArgvPlan, dataFile: string, rcfile: string | undefined): readonly string[] {
  return ['-c', BOOTSTRAP, 'run', `--data-file=${dataFile}`, ...(plan.branch ? ['--branch'] : []),
    ...(plan.source.length ? [`--source=${plan.source.join(',')}`] : []), ...(rcfile ? [`--rcfile=${rcfile}`] : []), ...plan.args];
}
/** `--fail-under=0`: a project's own `fail_under` must not turn a written report into exit 2; the thresholds are Redproof's. */
export function jsonArgs(dataFile: string, reportFile: string, rcfile: string | undefined): readonly string[] {
  return ['-c', BOOTSTRAP, 'json', `--data-file=${dataFile}`, '--fail-under=0', '-o', reportFile, ...(rcfile ? [`--rcfile=${rcfile}`] : [])];
}

/** Asks coverage.py, through its public API, what config it would auto-discover here and what that config excludes (versus the built-in defaults). */
const PROBE = [
  'import coverage, json',
  'def _list(c, key):',
  '    try: return list(c.get_option(key) or [])',
  '    except Exception: return []',
  'default = set(coverage.Coverage(config_file=False).get_option("report:exclude_lines") or [])',
  'c = coverage.Coverage(config_file=True)',
  'print(json.dumps({"files": list(c.config.config_files_read),',
  ' "omit": sorted(set((c.get_option("run:omit") or []) + (c.get_option("report:omit") or []))),',
  ' "include": sorted(set((c.get_option("run:include") or []) + (c.get_option("report:include") or []))),',
  ' "source": sorted(set(_list(c, "run:source") + _list(c, "run:source_pkgs") + _list(c, "run:source_dirs"))),',
  ' "plugins": _list(c, "run:plugins"),',
  ' "ignoreErrors": bool(c.get_option("report:ignore_errors")),',
  ' "exclude": [x for x in (c.get_option("report:exclude_lines") or []) if x not in default]}))',
].join('\n');
export const probeArgs = (): readonly string[] => ['-c', `import sys\nif sys.path and sys.path[0] == "": sys.path[0] = "/nonexistent-redproof"\n${PROBE}`];
