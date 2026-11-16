/**
 * What tach.toml says about which checks are switched on, read from a parsed TOML tree (the shell parses; this module
 * only reads). Every spelling TOML allows (inline tables, quoted keys and headers, dotted keys) reaches the same
 * tree, so a setting cannot hide behind one. A file that is not TOML, or holds a value of the wrong type, is a
 * `ConfigError`: the caller refuses, it never guesses.
 */
import { posix } from 'node:path';

export class ConfigError extends Error {}

type Table = { readonly [key: string]: unknown };
const isTable = (value: unknown): value is Table => typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
/** An own property only, so a key such as `constructor` never reads a prototype member. */
const field = (table: Table, key: string): unknown => (Object.hasOwn(table, key) ? table[key] : undefined);

function strings(value: unknown, what: string): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new ConfigError(`${what} must be a list of strings.`);
  return value as readonly string[];
}

function tables(value: unknown, what: string): readonly Table[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every(isTable)) throw new ConfigError(`${what} must be an array of tables.`);
  return value as readonly Table[];
}

function table(value: unknown, what: string): Table {
  if (value === undefined) return {};
  if (!isTable(value)) throw new ConfigError(`${what} must be a table.`);
  return value;
}

export type ModuleFacts = {
  readonly paths: readonly string[];
  readonly hasDependsOn: boolean;
  /** `depends_on` holds a pattern that matches every module (`**`), which allows what no `depends_on` allows. */
  readonly dependsOnAnything: boolean;
  readonly hasLayer: boolean;
  readonly unchecked: boolean;
  readonly hasCannotDependOn: boolean;
  readonly hasDeprecated: boolean;
  readonly hasVisibility: boolean;
};

export type ConfigFacts = {
  readonly forbidCircular: boolean;
  /** `true`, `false`, or `if_git_repo`; anything unrecognised counts as `true`, tach's default. */
  readonly respectGitignore: 'true' | 'false' | 'if_git_repo';
  readonly sourceRoots: readonly string[];
  /** The project's exclude patterns, kept as written: the adapter does not interpret them. tach 0.35 has no default when the key is absent. */
  readonly exclude: readonly string[];
  readonly modules: readonly ModuleFacts[];
  /** The `from` patterns of every `[[interfaces]]` entry, one list per entry. */
  readonly interfaceFrom: readonly (readonly string[])[];
  readonly hasInterfaceVisibility: boolean;
  readonly hasLayers: boolean;
  readonly unusedIgnoreDirectives: string;
  readonly localImports: string;
};

const DEFAULT_SOURCE_ROOTS = ['.'] as const;

/** A `depends_on` pattern made only of wildcards matches every module. */
const MATCHES_EVERYTHING = /^[*./]*\*[*./]*$/u;

function moduleFacts(entry: Table, paths: readonly string[]): ModuleFacts {
  const dependsOn = field(entry, 'depends_on');
  if (dependsOn !== undefined && !Array.isArray(dependsOn)) throw new ConfigError('depends_on must be a list.');
  const targets = (dependsOn ?? []).map((item: unknown): { path: string; deprecated: boolean } => {
    if (typeof item === 'string') return { path: item, deprecated: false };
    const path = isTable(item) ? field(item, 'path') : undefined;
    if (!isTable(item) || typeof path !== 'string') throw new ConfigError('depends_on entries must be a path or a table with a path.');
    return { path, deprecated: field(item, 'deprecated') === true };
  });
  const layer = field(entry, 'layer');
  return {
    paths,
    hasDependsOn: dependsOn !== undefined,
    dependsOnAnything: targets.some(target => MATCHES_EVERYTHING.test(target.path)),
    hasLayer: layer !== undefined && layer !== '' && !(Array.isArray(layer) && layer.length === 0),
    unchecked: field(entry, 'unchecked') === true,
    hasCannotDependOn: strings(field(entry, 'cannot_depend_on'), 'cannot_depend_on').length > 0,
    hasDeprecated: targets.some(target => target.deprecated),
    hasVisibility: field(entry, 'visibility') !== undefined,
  };
}

/**
 * The facts in one parsed config file. A `tach.domain.toml` is read the same way, plus its `[root]` table: the module
 * that owns the directory, with the same keys as a `[[modules]]` entry.
 */
export function readConfig(tree: unknown, kind: 'project' | 'domain' = 'project'): ConfigFacts {
  if (!isTable(tree)) throw new ConfigError('The config is not a TOML document.');
  const parsed: Table = tree;
  const modules = tables(field(parsed, 'modules'), 'modules').map(entry => moduleFacts(entry, [
    ...strings(typeof field(entry, 'path') === 'string' ? [field(entry, 'path')] : field(entry, 'path'), 'path'),
    ...strings(field(entry, 'paths'), 'paths'),
  ]));
  const root = kind === 'domain' && field(parsed, 'root') !== undefined ? [moduleFacts(table(field(parsed, 'root'), 'root'), ['<root>'])] : [];
  const interfaces = tables(field(parsed, 'interfaces'), 'interfaces');
  const layers = field(parsed, 'layers');
  if (layers !== undefined && !Array.isArray(layers)) throw new ConfigError('layers must be a list.');
  const rules = table(field(parsed, 'rules'), 'rules');
  const git = field(parsed, 'respect_gitignore');
  const roots = strings(field(parsed, 'source_roots'), 'source_roots');
  return {
    forbidCircular: field(parsed, 'forbid_circular_dependencies') === true,
    respectGitignore: git === false ? 'false' : git === 'if_git_repo' ? 'if_git_repo' : 'true',
    sourceRoots: roots.length ? roots : DEFAULT_SOURCE_ROOTS,
    exclude: strings(field(parsed, 'exclude'), 'exclude'),
    modules: [...modules, ...root],
    interfaceFrom: interfaces.map(entry => strings(field(entry, 'from'), 'interface from')),
    hasInterfaceVisibility: interfaces.some(entry => field(entry, 'visibility') !== undefined),
    hasLayers: Array.isArray(layers) && layers.length > 0,
    unusedIgnoreDirectives: String(field(rules, 'unused_ignore_directives') ?? 'warn'),
    localImports: String(field(rules, 'local_imports') ?? 'error'),
  };
}

/** Merge facts from a distributed `tach.domain.toml`: modules and interfaces defined there count too. */
export function mergeDomain(root: ConfigFacts, domain: ConfigFacts, where: string): ConfigFacts {
  // Domain module paths are relative to the domain, so they are named by the file that defines them and matched by ownership only.
  const named = domain.modules.map(m => ({ ...m, paths: m.paths.map(p => `${where}::${p}`) }));
  return {
    ...root,
    modules: [...root.modules, ...named],
    interfaceFrom: [...root.interfaceFrom, ...domain.interfaceFrom],
    hasInterfaceVisibility: root.hasInterfaceVisibility || domain.hasInterfaceVisibility,
    hasLayers: root.hasLayers || domain.hasLayers,
  };
}

/** What the shell found on disk, relative to the working directory, with `/` separators. */
export type SourceTree = {
  /** Regular `.py` files, in directories tach walks. */
  readonly python: readonly string[];
  /** Directories below the project that hold their own `.git`: a nested repository's ignore files are invisible to the outer git. */
  readonly nestedRepos: readonly string[];
  /** Symbolic links to a directory or to a `.py` file: tach does not follow them. */
  readonly symlinks: readonly string[];
  /** `.ignore` files in the project, and in every directory above it. tach reads them like a `.gitignore`. */
  readonly ignoreFiles: readonly string[];
};

/** A source root as a clean relative path: `src/.`, `./src//` and `src/../src` all become `src`; the project itself is the empty string. */
export function normalRoot(root: string): string {
  const clean = posix.normalize(root.replaceAll('\\', '/')).replace(/\/+$/u, '');
  return clean === '.' || clean === '' ? '' : clean;
}

const inRoots = (file: string, facts: ConfigFacts): boolean =>
  facts.sourceRoots.map(normalRoot).some(root => root === '' || file === root || file.startsWith(`${root}/`));

/** Python files in a source root, from the walk. */
const inSourceRoots = (tree: SourceTree, facts: ConfigFacts): readonly string[] => tree.python.filter(file => inRoots(file, facts));

/** The ignored `.py` files that would hide first-party code from tach: those the walk found inside a source root. */
export function hiddenSources(ignored: readonly string[], tree: SourceTree, facts: ConfigFacts): readonly string[] {
  const listed = new Set(ignored);
  return inSourceRoots(tree, facts).filter(file => listed.has(file));
}

/** Symbolic links tach does not follow, inside a source root. */
export function symlinkedSources(tree: SourceTree, facts: ConfigFacts): readonly string[] {
  return tree.symlinks.filter(link => inRoots(link, facts));
}

/** Nested repositories inside a source root. */
export function nestedRepositories(tree: SourceTree, facts: ConfigFacts): readonly string[] {
  return tree.nestedRepos.filter(repo => inRoots(repo, facts) || facts.sourceRoots.map(normalRoot).some(root => root !== '' && root.startsWith(`${repo}/`)));
}

/** Whether some module is checked for a layer (a `layers` list that no module uses enforces nothing). */
export const layersAssigned = (facts: ConfigFacts): boolean => facts.modules.some(module => !module.unchecked && module.hasLayer);

/** Whether some `[[interfaces]]` entry names a module that exists (an interface whose `from` matches nothing enforces nothing). */
export function interfacesAnchored(facts: ConfigFacts): boolean {
  const known = facts.modules.filter(module => !module.unchecked).flatMap(module => module.paths);
  return facts.interfaceFrom.some(patterns => patterns.some(pattern => {
    if (known.some(path => path.includes('::') || /[*?[\]]/u.test(path))) return true;
    try {
      const expression = new RegExp(pattern, 'u');
      return known.some(path => expression.test(path));
    } catch {
      return true;
    }
  }));
}
