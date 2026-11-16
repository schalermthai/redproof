import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ConfigError, hiddenSources, interfacesAnchored, layersAssigned, mergeDomain, nestedRepositories, normalRoot, overlappingRoots, symlinkedSources, unsafeExcludes,
  type SourceTree,
} from '../src/core/config.ts';
import { configRefusal, escapingRoots, overlapRefusal, sourcesRefusal, symlinkRefusal } from '../src/core/guards.ts';
import type { TachRuleKind } from '../src/core/model.ts';
import { facts as readConfig } from './support/toml.ts';

const EMPTY: SourceTree = { python: [], symlinks: [], nestedRepos: [], domainFiles: [], environments: [], ignoreFiles: [] };
const tree = (python: readonly string[], more: Partial<SourceTree> = {}): SourceTree => ({ ...EMPTY, python, ...more });

const MODULES = '[[modules]]\npath = "a"\ndepends_on = ["b"]\n[[modules]]\npath = "b"\ndepends_on = []\n';

// A setting must be the top-level key, not text that merely contains it.
const SPOOFS: ReadonlyArray<readonly [string, string, boolean]> = [
  ['plain', 'forbid_circular_dependencies = true\n', true],
  ['trailing comment', 'forbid_circular_dependencies = true # on\n', true],
  ['spaces', '  forbid_circular_dependencies   =   true\n', true],
  ['commented out', '# forbid_circular_dependencies = true\n', false],
  ['false', 'forbid_circular_dependencies = false\n', false],
  ['string "true"', 'forbid_circular_dependencies = "true"\n', false],
  ['inside another table', '[rules]\nforbid_circular_dependencies = true\n', false],
  ['inside a module table', '[[modules]]\npath = "a"\nforbid_circular_dependencies = true\n', false],
  ['inside a basic multi-line string', 'note = """\nforbid_circular_dependencies = true\n"""\n', false],
  ['inside a literal multi-line string', "note = '''\nforbid_circular_dependencies = true\n'''\n", false],
  ['inside a one-line string', 'note = "x\\" # y\\nforbid_circular_dependencies = true"\n', false],
  ['inside a multi-line array', 'exclude = [\n  "a",\n  # forbid_circular_dependencies = true\n]\n', false],
  ['after a table header the key belongs to that table', `${MODULES}forbid_circular_dependencies = true\n`, false],
  ['a dotted key under another name', 'rules.forbid_circular_dependencies = true\n', false],
  ['set before the tables', `forbid_circular_dependencies = true\n${MODULES}`, true],
];
for (const [name, text, expected] of SPOOFS) {
  test(`forbid_circular_dependencies is read structurally: ${name} -> ${expected}`, () => assert.equal(readConfig(text).forbidCircular, expected));
}

test('facts: layers, interfaces, rules (table or inline), respect_gitignore, source roots', () => {
  const facts = readConfig(`respect_gitignore = false\nsource_roots = ["src", "lib"]\nlayers = ["ui", { name = "core", closed = true }]\nrules = { local_imports = "off" }\ninterfaces = [{ expose = ["x"], from = ["b"] }]\nmodules = [{ path = "a", depends_on = ["b"] }, { path = "b", depends_on = [] }]\n`);
  assert.equal(facts.respectGitignore, 'false');
  assert.deepEqual(facts.sourceRoots, ['src', 'lib']);
  assert.equal(facts.hasLayers, true);
  assert.deepEqual(facts.interfaceFrom, [['b']]);
  assert.deepEqual(facts.modules.map(m => m.paths), [['a'], ['b']], 'an inline array of tables is read like [[modules]]');
  assert.equal(facts.localImports, 'off');
  assert.equal(readConfig('respect_gitignore = "if_git_repo"\n').respectGitignore, 'if_git_repo');
  assert.equal(readConfig('').respectGitignore, 'true');
  assert.deepEqual(readConfig('').sourceRoots, ['.']);
  assert.equal(readConfig('[rules]\nunused_ignore_directives = "off"\n').unusedIgnoreDirectives, 'off');
  assert.equal(readConfig('').unusedIgnoreDirectives, 'warn', 'tach default');
  assert.equal(readConfig('').localImports, 'error', 'tach default');
});

test('module facts: depends_on, layer, unchecked, cannot_depend_on, deprecated (a string cannot spoof it), visibility', () => {
  const facts = readConfig(`[[modules]]\npath = "a"\nunchecked = true\n[[modules]]\npath = "b"\ncannot_depend_on = ["a"]\nvisibility = ["c"]\ndepends_on = [{ path = "c", deprecated = true }]\n[[modules]]\npath = "deprecated = true"\ndepends_on = ["x"]\n[[modules]]\npaths = ["p", "q"]\nlayer = "low"\n`);
  const [a, b, spoof, multi] = facts.modules;
  assert.deepEqual([a?.unchecked, a?.hasDependsOn], [true, false]);
  assert.deepEqual([b?.hasCannotDependOn, b?.hasDeprecated, b?.hasVisibility], [true, true, true]);
  assert.equal(spoof?.hasDeprecated, false);
  assert.deepEqual([multi?.paths, multi?.hasLayer], [['p', 'q'], true]);
});

const everything = 'forbid_circular_dependencies = true\nlayers = ["h", "l"]\n[[interfaces]]\nexpose = ["x"]\nfrom = ["b"]\n[[modules]]\npath = "a"\nlayer = "h"\ndepends_on = [{ path = "b", deprecated = true }]\ncannot_depend_on = ["c"]\nvisibility = ["z"]\n[[modules]]\npath = "b"\ndepends_on = []\n';
const ALL: readonly TachRuleKind[] = ['undeclared-dependency', 'forbidden-dependency', 'deprecated-dependency', 'layer-violation', 'interface-violation', 'ignore-directive', 'circular-dependency', 'visibility-violation'];

test('a fully configured project has nothing to refuse', () => assert.equal(configRefusal(ALL, readConfig(everything), {}), undefined));

// The rule that is selected has its evidence switched off or never configured: a clean report would prove nothing.
const INACTIVE: ReadonlyArray<readonly [TachRuleKind, string, RegExp]> = [
  ['circular-dependency', everything.replace('forbid_circular_dependencies = true\n', ''), /forbid_circular_dependencies/u],
  ['interface-violation', everything.replace('[[interfaces]]\nexpose = ["x"]\nfrom = ["b"]\n', ''), /no `\[\[interfaces\]\]`/u],
  ['layer-violation', everything.replace('layers = ["h", "l"]\n', ''), /no `layers`/u],
  ['forbidden-dependency', everything.replace('cannot_depend_on = ["c"]\n', ''), /cannot_depend_on/u],
  ['deprecated-dependency', everything.replace('{ path = "b", deprecated = true }', '"b"'), /deprecated = true/u],
  ['visibility-violation', everything.replace('visibility = ["z"]\n', ''), /visibility/u],
  ['ignore-directive', `[rules]\nunused_ignore_directives = "off"\n${everything}`, /unused_ignore_directives/u],
  ['undeclared-dependency', everything.replace('depends_on = []\n', ''), /may import anything: b/u],
  ['undeclared-dependency', `[rules]\nlocal_imports = "off"\n${everything}`, /local_imports/u],
  ['undeclared-dependency', everything.replace('path = "b"\n', 'path = "b"\nunchecked = true\n'), /unchecked/u],
];
for (const [kind, text, pattern] of INACTIVE) {
  test(`${kind} selected but inactive REFUSES, naming why: ${pattern.source}`, () => {
    const refusal = configRefusal([kind], readConfig(text), {});
    assert.ok(refusal, 'expected a refusal');
    assert.equal(refusal.code, kind === 'circular-dependency' ? 'tach-cycle-check-off' : 'tach-rule-inactive');
    assert.match(`${refusal.message}\n${refusal.detail}`, pattern);
    if (kind !== 'circular-dependency') assert.equal(configRefusal([kind], readConfig(text), { allowInactiveRules: true }), undefined, 'the opt-in');
    else assert.equal(configRefusal([kind], readConfig(text), { allowInactiveRules: true })?.code, 'tach-cycle-check-off', 'no opt-in: set the key');
  });
}

test('a rule not selected is not held to its configuration', () => {
  assert.equal(configRefusal(['undeclared-dependency'], readConfig('[[modules]]\npath = "a"\ndepends_on = []\n'), {}), undefined);
});

test('source roots that leave the Gate root are named', () => {
  assert.deepEqual(escapingRoots(['src', './lib', 'a/../b', '../x', '/etc', 'C:\\x', '..', 'a/../../x']), ['../x', '/etc', 'C:\\x', '..', 'a/../../x']);
});

test('ignored sources: only the Python the walk found under a source root', () => {
  const facts = readConfig('source_roots = ["src"]\n');
  const found = tree(['src/a/x.py', 'src/a/readme.py', 'tools/t.py', 'src/tests/t.py']);
  assert.deepEqual(hiddenSources(['src/a/x.py', 'tools/t.py', 'src/tests/t.py', 'src/other/gone.py'], found, facts), ['src/a/x.py', 'src/tests/t.py'], 'no default exclude: tests/ is read by tach');
  assert.deepEqual(hiddenSources(['x.py', 'a/y.py'], tree(['x.py', 'a/y.py']), readConfig('')), ['x.py', 'a/y.py'], 'default source root is the project');
});

test('source roots are compared as paths, not as text', () => {
  for (const spelling of ['src', 'src/.', './src//', '././src', 'src/../src', 'src/', './src']) assert.equal(normalRoot(spelling), 'src', spelling);
  for (const spelling of ['.', './', '', 'a/..']) assert.equal(normalRoot(spelling), '', spelling);
  assert.equal(normalRoot('a\\b'), 'a/b');
  for (const spelling of ['src/.', './src//', '././src']) {
    assert.deepEqual(hiddenSources(['src/a/x.py'], tree(['src/a/x.py']), readConfig(`source_roots = [${JSON.stringify(spelling)}]\n`)), ['src/a/x.py'], spelling);
  }
});

test('ignoredRefusal: hidden files, unknown, .ignore files, opt-in, respect_gitignore = false', () => {
  const facts = readConfig('source_roots = ["src"]\n');
  const found = tree(['src/a/x.py']);
  assert.equal(sourcesRefusal(['src/a/x.py'], found, facts, {})?.code, 'tach-ignored-sources');
  assert.equal(sourcesRefusal(undefined, found, facts, {})?.code, 'tach-ignored-sources-unknown');
  assert.equal(sourcesRefusal([], found, facts, {}), undefined);
  assert.equal(sourcesRefusal([], tree([], { ignoreFiles: ['src/.ignore'] }), facts, {})?.code, 'tach-ignored-sources', 'a .ignore file: git cannot say what it hides');
  assert.equal(sourcesRefusal(undefined, tree([], { ignoreFiles: ['../.ignore'] }), facts, {})?.code, 'tach-ignored-sources');
  assert.equal(sourcesRefusal(['src/a/x.py'], found, facts, { allowIgnoredSources: true }), undefined);
  assert.equal(sourcesRefusal([], tree([], { ignoreFiles: ['.ignore'] }), facts, { allowIgnoredSources: true }), undefined);
  const off = readConfig('source_roots = ["src"]\nrespect_gitignore = false\n');
  assert.equal(sourcesRefusal(['src/a/x.py'], found, off, {})?.code, 'tach-ignored-sources', 'respect_gitignore = false leaves .git/info/exclude on: the listing is its');
  assert.equal(sourcesRefusal(undefined, found, off, {})?.code, 'tach-ignored-sources-unknown');
  assert.equal(sourcesRefusal([], found, off, {}), undefined);
  assert.equal(sourcesRefusal([], tree([], { ignoreFiles: ['.ignore'] }), off, {}), undefined, 'tach switches .ignore off with respect_gitignore = false');
  assert.equal(sourcesRefusal(['src/a/x.py'], found, off, { allowIgnoredSources: true }), undefined);
});

test('symbolic links under a source root are named, unless outside the roots or accepted', () => {
  const facts = readConfig('source_roots = ["src"]\n');
  const links = tree([], { symlinks: ['src/a', 'src/b/x.py', 'tools/t'] });
  assert.deepEqual(symlinkedSources(links, facts), ['src/a', 'src/b/x.py']);
  assert.equal(symlinkRefusal(links, facts, {})?.code, 'tach-symlinked-sources');
  assert.equal(symlinkRefusal(links, facts, { allowIgnoredSources: true }), undefined);
  assert.equal(symlinkRefusal(tree([], { symlinks: ['tools/t'] }), facts, {}), undefined);
});

test('a tach.domain.toml [root] is a module with the same keys, named by the file that defines it', () => {
  const domain = readConfig('[root]\nunchecked = true\n[[modules]]\npath = "service"\ndepends_on = []\n', 'domain');
  assert.deepEqual(domain.modules.map(m => [m.paths, m.unchecked]), [[['service'], false], [['<root>'], true]]);
  const merged = mergeDomain(readConfig('source_roots = ["src"]\n'), domain, 'src/a');
  assert.deepEqual(merged.modules.map(m => m.paths), [['src/a::service'], ['src/a::<root>']]);
  assert.match(configRefusal(['undeclared-dependency'], merged, {})?.detail ?? '', /unchecked.*src\/a::<root>/u);
  assert.deepEqual(readConfig('[root]\nunchecked = true\n').modules, [], 'a [root] table means nothing in tach.toml itself');
});

test('exclude is kept as written and never interpreted: environment and cache names pass, anything else refuses', () => {
  const found = tree(['src/a/x.py']);
  assert.deepEqual(readConfig('').exclude, [], 'tach 0.35 has no default list');
  assert.equal(sourcesRefusal([], found, readConfig('source_roots = ["src"]\n'), {}), undefined);
  for (const pattern of ['src/a', '**/{a,b}', 'zzz', '[!x]*', '**/tests', '**/docs', 'venv ', 'build/x', '**/venv/../a']) {
    const refusal = sourcesRefusal([], found, readConfig(`source_roots = ["src"]\nexclude = [${JSON.stringify(pattern)}]\n`), {});
    assert.equal(refusal?.code, 'tach-ignored-sources', pattern);
    assert.match(refusal?.detail ?? '', /allowExcludedSources/u);
    assert.equal(sourcesRefusal([], found, readConfig(`source_roots = ["src"]\nexclude = [${JSON.stringify(pattern)}]\n`), { allowExcludedSources: true }), undefined, 'the exclude hatch');
    assert.equal(sourcesRefusal([], found, readConfig(`source_roots = ["src"]\nexclude = [${JSON.stringify(pattern)}]\n`), { allowIgnoredSources: true })?.code, 'tach-ignored-sources', 'the ignore hatch does not cover it');
  }
  for (const pattern of ['venv', '**/venv', '**/*__pycache__', '**/*egg-info', '.venv', 'node_modules/', '/build', 'dist', '**/.tox', '.git', '**/build/**']) {
    assert.equal(sourcesRefusal([], found, readConfig(`source_roots = ["src"]\nexclude = [${JSON.stringify(pattern)}]\n`), {}), undefined, pattern);
  }
  assert.equal(unsafeExcludes(readConfig('exclude = ["**/venv"]\n[[modules]]\npath = "app.venv"\n')).length, 1, 'an entry that names a module is not an environment');
});

test('source roots: a glob covers the whole tree; roots that contain each other, or a glob beside another root, overlap', () => {
  const globbed = readConfig('source_roots = ["s*"]\n');
  assert.deepEqual(hiddenSources(['a/x.py'], tree(['a/x.py']), globbed), ['a/x.py']);
  assert.deepEqual(symlinkedSources(tree([], { symlinks: ['q/l'] }), globbed), ['q/l']);
  const overlap = (roots: string): number => overlappingRoots(readConfig(`source_roots = ${roots}\n`)).length;
  for (const roots of ['[".", "src"]', '["src", "src/a"]', '["src", "./src/"]', '["s*", "src"]', '["src/**"]', '["{a,b}"]', '["src", "src"]']) assert.ok(overlap(roots) > 0, roots);
  for (const roots of ['["src"]', '["src", "lib"]', '["src/a", "src/b"]', '["s*"]', '["a?"]', '["src", "srcs"]']) assert.equal(overlap(roots), 0, roots);
  assert.equal(overlapRefusal(readConfig('source_roots = ["src", "src/a"]\n'))?.code, 'tach-overlapping-source-roots');
  assert.equal(overlapRefusal(readConfig('source_roots = ["src"]\n')), undefined);
});

test('environments and domain files: a venv-named directory with pyvenv.cfg is not hidden code; a domain file counts as a source', () => {
  const facts = readConfig('source_roots = ["src"]\n');
  const found = { ...EMPTY, python: ['src/venv/bin/a.py', 'src/legacy/b.py'], symlinks: ['src/venv/lib64'], environments: ['src/venv'], domainFiles: ['src/a/tach.domain.toml'] };
  assert.deepEqual(hiddenSources(['src/venv/bin/a.py', 'src/legacy/b.py', 'src/a/tach.domain.toml'], found, facts), ['src/legacy/b.py', 'src/a/tach.domain.toml']);
  assert.deepEqual(symlinkedSources(found, facts), []);
});

test('nested repositories refuse as unknown when inside a source root (or above it), unless accepted or tach switches nothing off', () => {
  const facts = readConfig('source_roots = ["src"]\n');
  const nested = tree(['src/a/x.py'], { nestedRepos: ['src/a'] });
  assert.deepEqual(nestedRepositories(nested, facts), ['src/a']);
  assert.deepEqual(nestedRepositories(tree([], { nestedRepos: ['tools/x'] }), facts), []);
  assert.equal(sourcesRefusal([], nested, facts, {})?.code, 'tach-ignored-sources-unknown');
  assert.equal(sourcesRefusal([], nested, facts, { allowIgnoredSources: true }), undefined);
  assert.equal(sourcesRefusal([], tree([], { nestedRepos: ['tools/x'] }), facts, {}), undefined);
  assert.equal(nestedRepositories(tree([], { nestedRepos: ['src'] }), readConfig('source_roots = ["src/a"]\n')).length, 1, 'the root sits inside a nested repository');
});

test('layers and interfaces must be anchored to modules to enforce anything', () => {
  assert.equal(layersAssigned(readConfig('layers = ["a"]\n[[modules]]\npath = "m"\n')), false);
  assert.equal(layersAssigned(readConfig('layers = ["a"]\n[[modules]]\npath = "m"\nlayer = "a"\n')), true);
  assert.equal(layersAssigned(readConfig('layers = ["a"]\n[[modules]]\npath = "m"\nlayer = "a"\nunchecked = true\n')), false, 'an unchecked module enforces nothing');
  const iface = (from: string): ReturnType<typeof readConfig> => readConfig(`[[interfaces]]\nexpose = ["x"]\nfrom = ["${from}"]\n[[modules]]\npath = "billing.core"\n`);
  assert.equal(interfacesAnchored(iface('billing.core')), true);
  assert.equal(interfacesAnchored(iface('^billing')), true, 'a pattern that matches');
  assert.equal(interfacesAnchored(iface('zzz')), false);
  assert.equal(interfacesAnchored(iface('(')), true, 'a pattern tach will reject itself is not this adapter\'s call');
  assert.equal(interfacesAnchored(readConfig('')), false);
});

test('depends_on that matches every module is as open as no depends_on', () => {
  const open = (pattern: string): boolean | undefined => readConfig(`[[modules]]\npath = "a"\ndepends_on = [${JSON.stringify(pattern)}]\n`).modules[0]?.dependsOnAnything;
  for (const pattern of ['**', '*', '**/*', '.*']) assert.equal(open(pattern), true, pattern);
  for (const pattern of ['b', 'b.*', 'b.**', '*.b']) assert.equal(open(pattern), false, pattern);
});

test('a config that cannot be read is an error, never a guess: a value of the wrong type (text that is not TOML is refused by the shell, see hidden.native.test.ts)', () => {
  for (const text of ['modules = "a"\n', 'modules = [1]\n', 'exclude = "src"\n', 'source_roots = [1]\n', 'layers = "a"\n', 'rules = 1\n',
    '[[modules]]\npath = "a"\ndepends_on = "b"\n', '[[modules]]\npath = "a"\ndepends_on = [1]\n', '[[modules]]\npath = "a"\ndepends_on = [{ deprecated = true }]\n']) {
    assert.throws(() => readConfig(text), ConfigError, text);
  }
});

test('keys are own properties: a key named like a prototype member is just a key', () => {
  assert.equal(readConfig('constructor = 1\ntoString = 2\n"__proto__" = 3\n').forbidCircular, false);
  assert.equal(readConfig('[rules]\nconstructor = "x"\n').localImports, 'error');
  assert.equal(readConfig('modules = [{ path = "a", constructor = 1 }]\n').modules.length, 1);
});
