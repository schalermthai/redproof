/**
 * What tach.toml says about which checks are switched on, read with a small structural TOML scanner (not a line
 * match): comments, strings (including multi-line ones), arrays and table headers are understood, so a comment, a
 * string, or a key that belongs to another table cannot pass for a top-level setting.
 */

export type Statement = { readonly kind: 'header'; readonly name: string; readonly array: boolean }
  | { readonly kind: 'pair'; readonly key: string; readonly value: string };

/** Split TOML text into logical statements: a header, or `key = value` with comments removed and strings intact. */
export function statements(text: string): readonly Statement[] {
  const out: Statement[] = [];
  let current = '';
  let depth = 0;
  let i = 0;
  const flush = (): void => {
    const line = current.trim();
    current = '';
    if (!line) return;
    const header = /^(\[\[?)\s*([^\]]*?)\s*\]\]?$/u.exec(line);
    if (header && depth === 0 && !line.includes('=')) {
      out.push({ kind: 'header', name: header[2]!.replace(/\s*\.\s*/gu, '.'), array: header[1] === '[[' });
      return;
    }
    const split = splitPair(line);
    if (split) out.push({ kind: 'pair', ...split });
  };
  while (i < text.length) {
    const c = text[i]!;
    if (c === '#') { while (i < text.length && text[i] !== '\n') i++; continue; }
    const triple = text.startsWith('"""', i) ? '"""' : text.startsWith("'''", i) ? "'''" : '';
    if (triple) {
      const end = text.indexOf(triple, i + 3);
      const stop = end === -1 ? text.length : end + 3;
      current += text.slice(i, stop); i = stop; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== c && text[j] !== '\n') { if (c === '"' && text[j] === '\\') j++; j++; }
      current += text.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === '[' || c === '{') { if (current.includes('=')) depth++; current += c; i++; continue; }
    if (c === ']' || c === '}') { if (depth > 0) depth--; current += c; i++; continue; }
    if (c === '\n' && depth === 0) { flush(); i++; continue; }
    current += c; i++;
  }
  flush();
  return out;
}

function splitPair(line: string): { key: string; value: string } | undefined {
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quote) { if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '=') {
      const key = line.slice(0, i).trim().replace(/\s*\.\s*/gu, '.').replace(/["']/gu, '');
      return key ? { key, value: line.slice(i + 1).trim() } : undefined;
    }
  }
  return undefined;
}

/** Replace the contents of every string with `_`, so a pattern test on a value cannot be satisfied by quoted text. */
const masked = (value: string): string => value.replace(/"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\\n]|\\.)*"|'[^'\n]*'/gu, '"_"');

function stringsIn(value: string): readonly string[] {
  return [...value.matchAll(/"((?:[^"\\\n]|\\.)*)"|'([^'\n]*)'/gu)].map(m => m[1] ?? m[2] ?? '');
}

export type ModuleFacts = {
  readonly paths: readonly string[];
  readonly hasDependsOn: boolean;
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
  /** The project's exclude patterns, or undefined when tach's defaults apply. */
  readonly exclude: readonly string[] | undefined;
  readonly modules: readonly ModuleFacts[];
  readonly hasInterfaces: boolean;
  readonly hasInterfaceVisibility: boolean;
  readonly hasLayers: boolean;
  readonly unusedIgnoreDirectives: string;
  readonly localImports: string;
};

const DEFAULT_SOURCE_ROOTS = ['.'] as const;

/** tach's own default when the project sets no `exclude`. */
const DEFAULT_EXCLUDES: readonly string[] = ['**/tests', '**/docs', '**/*__pycache__', '**/*egg-info', '**/venv'];

export function readConfig(text: string): ConfigFacts {
  const all = statements(text);
  const top = new Map<string, string>();
  const modules: ModuleFacts[] = [];
  let table = '';
  let moduleKeys: Map<string, string> | undefined;
  let interfaces = 0;
  let interfaceVisibility = false;
  const closeModule = (): void => {
    if (!moduleKeys) return;
    const keys = moduleKeys;
    const dependsOn = keys.get('depends_on') ?? '';
    modules.push({
      paths: moduleKeys === keys && table === 'root' ? ['<root>'] : [...stringsIn(keys.get('path') ?? ''), ...stringsIn(keys.get('paths') ?? '')],
      hasDependsOn: keys.has('depends_on'),
      hasLayer: keys.has('layer'),
      unchecked: masked(keys.get('unchecked') ?? '').trim() === 'true',
      hasCannotDependOn: stringsIn(keys.get('cannot_depend_on') ?? '').length > 0,
      hasDeprecated: /deprecated\s*=\s*true/u.test(masked(dependsOn)),
      hasVisibility: keys.has('visibility'),
    });
    moduleKeys = undefined;
  };
  for (const s of all) {
    if (s.kind === 'header') {
      closeModule();
      table = s.name;
      // `[root]` in a tach.domain.toml defines the module that owns the directory, with the same keys as a `[[modules]]` entry.
      if ((s.array && s.name === 'modules') || (!s.array && s.name === 'root')) moduleKeys = new Map();
      if (s.array && s.name === 'interfaces') interfaces++;
      continue;
    }
    if ((table === 'modules' || table === 'root') && moduleKeys) { moduleKeys.set(s.key, s.value); continue; }
    if (table === 'interfaces' && s.key === 'visibility') interfaceVisibility = true;
    top.set(table ? `${table}.${s.key}` : s.key, s.value);
  }
  closeModule();
  // `rules = { local_imports = "off" }` is the inline spelling of the `[rules]` table.
  const rule = (name: string): string => {
    const flat = top.get(`rules.${name}`);
    if (flat !== undefined) return stringsIn(flat)[0] ?? '';
    const inline = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'u').exec(top.get('rules') ?? '');
    return inline?.[1] ?? '';
  };
  const gitignore = masked(top.get('respect_gitignore') ?? '').trim();
  const rawGit = stringsIn(top.get('respect_gitignore') ?? '')[0];
  const excludeRaw = top.get('exclude');
  const roots = stringsIn(top.get('source_roots') ?? '');
  const layersValue = top.get('layers');
  return {
    forbidCircular: (top.get('forbid_circular_dependencies') ?? '').trim() === 'true',
    respectGitignore: gitignore === 'false' ? 'false' : rawGit === 'if_git_repo' ? 'if_git_repo' : 'true',
    sourceRoots: roots.length ? roots : DEFAULT_SOURCE_ROOTS,
    exclude: excludeRaw === undefined ? undefined : stringsIn(excludeRaw),
    modules,
    hasInterfaces: interfaces > 0,
    hasInterfaceVisibility: interfaceVisibility,
    hasLayers: layersValue !== undefined && stringsIn(layersValue).length + (layersValue.includes('name') ? 1 : 0) > 0,
    unusedIgnoreDirectives: rule('unused_ignore_directives') || 'warn',
    localImports: rule('local_imports') || 'error',
  };
}

/** Merge facts from a distributed `tach.domain.toml`: modules and interfaces defined there count too. */
export function mergeDomain(root: ConfigFacts, domain: ConfigFacts, where: string): ConfigFacts {
  // Domain module paths are relative to the domain, so they are named by the file that defines them and never matched against `exclude`.
  const named = domain.modules.map(m => ({ ...m, paths: m.paths.map(p => `${where}::${p}`) }));
  return {
    ...root,
    modules: [...root.modules, ...named],
    hasInterfaces: root.hasInterfaces || domain.hasInterfaces,
    hasInterfaceVisibility: root.hasInterfaceVisibility || domain.hasInterfaceVisibility,
    hasLayers: root.hasLayers || domain.hasLayers,
  };
}

/** A gitignore-style glob as a RegExp over a project-relative path. Covers `**`, `*`, `?`, a leading `/`, a trailing `/`. */
export function globToRegExp(pattern: string): RegExp {
  const anchored = pattern.startsWith('/') || pattern.replace(/\/$/u, '').includes('/') && !pattern.startsWith('**/');
  const body = pattern.replace(/^\//u, '').replace(/\/$/u, '')
    .replace(/[.+^${}()|\\]/gu, '\\$&')
    .replace(/\*\*\//gu, '\u0001').replace(/\/\*\*/gu, '\u0002').replace(/\*\*/gu, '\u0003')
    .replace(/\*/gu, '[^/]*').replace(/\?/gu, '[^/]')
    .replace(/\u0001/gu, '(?:.*/)?').replace(/\u0002/gu, '(?:/.*)?').replace(/\u0003/gu, '.*');
  return new RegExp(`${anchored ? '^' : '(?:^|/)'}${body}(?:/.*)?$`, 'u');
}

function isExcluded(path: string, facts: ConfigFacts): boolean {
  return (facts.exclude ?? DEFAULT_EXCLUDES).some(pattern => globToRegExp(pattern).test(path));
}

/** Directories no project keeps first-party sources in: a gitignored `.py` here never hides a module. */
const NOT_SOURCES = /(?:^|\/)(?:\.venv|\.tox|\.nox|\.eggs|\.git|node_modules|site-packages|\.mypy_cache|\.pytest_cache|\.ruff_cache)(?:\/|$)/u;

/** The ignored `.py` files that would hide first-party code from tach: inside a source root, not excluded, not an environment. */
export function hiddenSources(ignored: readonly string[], facts: ConfigFacts): readonly string[] {
  const roots = facts.sourceRoots.map(r => r.replace(/^\.\//u, '').replace(/\/$/u, ''));
  return ignored.filter(file => file.endsWith('.py') && !NOT_SOURCES.test(file) && !isExcluded(file, facts)
    && roots.some(r => r === '.' || r === '' || file === r || file.startsWith(`${r}/`)));
}

/** Module directories (dotted path to slashes) that the project's exclude removes from the walk. */
export function excludedModules(facts: ConfigFacts): readonly string[] {
  const hidden: string[] = [];
  for (const module of facts.modules) {
    for (const path of module.paths) {
      if (/[*?[\]]/u.test(path) || path === '<root>' || path.includes('::')) continue;
      const dir = path.replaceAll('.', '/');
      const roots = facts.sourceRoots.map(r => r.replace(/^\.\//u, '').replace(/\/$/u, '')).map(r => (r === '.' || r === '' ? dir : `${r}/${dir}`));
      if (roots.length && roots.some(candidate => isExcluded(candidate, facts))) hidden.push(path);
    }
  }
  return hidden;
}
