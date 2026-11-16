import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ConfigError, excludedModules, excludedSources, globToRegExp, hiddenSources, interfacesAnchored, layersAssigned, mergeDomain, normalRoot, symlinkedSources,
  type SourceTree,
} from '../src/core/config.ts';
import { configRefusal, escapingRoots, ignoredRefusal, symlinkRefusal } from '../src/core/guards.ts';
import type { TachRuleKind } from '../src/core/model.ts';
import { facts as readConfig } from './support/toml.ts';

const EMPTY: SourceTree = { python: [], symlinks: [], ignoreFiles: [] };
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

test('a fully configured project has nothing to refuse', () => assert.equal(configRefusal(ALL, readConfig(everything), EMPTY, {}), undefined));

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
  ['undeclared-dependency', `exclude = ["b"]\n${everything}`, /whole modules.*b/u],
  ['layer-violation', `exclude = ["src/a"]\nsource_roots = ["src"]\n${everything}`, /whole modules.*a/u],
];
for (const [kind, text, pattern] of INACTIVE) {
  test(`${kind} selected but inactive REFUSES, naming why: ${pattern.source}`, () => {
    const refusal = configRefusal([kind], readConfig(text), EMPTY, {});
    assert.ok(refusal, 'expected a refusal');
    assert.equal(refusal.code, kind === 'circular-dependency' ? 'tach-cycle-check-off' : 'tach-rule-inactive');
    assert.match(`${refusal.message}\n${refusal.detail}`, pattern);
    if (kind !== 'circular-dependency') assert.equal(configRefusal([kind], readConfig(text), EMPTY, { allowInactiveRules: true }), undefined, 'the opt-in');
    else assert.equal(configRefusal([kind], readConfig(text), EMPTY, { allowInactiveRules: true })?.code, 'tach-cycle-check-off', 'no opt-in: set the key');
  });
}

test('a rule not selected is not held to its configuration', () => {
  assert.equal(configRefusal(['undeclared-dependency'], readConfig('[[modules]]\npath = "a"\ndepends_on = []\n'), EMPTY, {}), undefined);
});

test('source roots that leave the Gate root are named', () => {
  assert.deepEqual(escapingRoots(['src', './lib', 'a/../b', '../x', '/etc', 'C:\\x', '..', 'a/../../x']), ['../x', '/etc', 'C:\\x', '..', 'a/../../x']);
});

test('ignored sources: only first-party Python the walk found under a source root, and not excluded', () => {
  const facts = readConfig('source_roots = ["src"]\n');
  const found = tree(['src/a/x.py', 'src/a/readme.py', 'tools/t.py', 'src/tests/t.py']);
  assert.deepEqual(hiddenSources(['src/a/x.py', 'tools/t.py', 'src/tests/t.py', 'src/other/gone.py'], found, facts), ['src/a/x.py', 'src/tests/t.py'], 'no default exclude: tests/ is read by tach');
  assert.deepEqual(hiddenSources(['x.py', 'a/y.py'], tree(['x.py', 'a/y.py']), readConfig('')), ['x.py', 'a/y.py'], 'default source root is the project');
  assert.deepEqual(hiddenSources(['src/gen/x.py'], tree(['src/gen/x.py']), readConfig('source_roots = ["src"]\nexclude = ["src/gen"]\n')), [], 'an excluded path is skipped by tach anyway');
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
  assert.equal(ignoredRefusal(['src/a/x.py'], found, facts, {})?.code, 'tach-ignored-sources');
  assert.equal(ignoredRefusal(undefined, found, facts, {})?.code, 'tach-ignored-sources-unknown');
  assert.equal(ignoredRefusal([], found, facts, {}), undefined);
  assert.equal(ignoredRefusal([], tree([], { ignoreFiles: ['src/.ignore'] }), facts, {})?.code, 'tach-ignored-sources', 'a .ignore file: git cannot say what it hides');
  assert.equal(ignoredRefusal(undefined, tree([], { ignoreFiles: ['../.ignore'] }), facts, {})?.code, 'tach-ignored-sources');
  assert.equal(ignoredRefusal(['src/a/x.py'], found, facts, { allowIgnoredSources: true }), undefined);
  assert.equal(ignoredRefusal([], tree([], { ignoreFiles: ['.ignore'] }), facts, { allowIgnoredSources: true }), undefined);
  const off = readConfig('source_roots = ["src"]\nrespect_gitignore = false\n');
  assert.equal(ignoredRefusal(['src/a/x.py'], found, off, {})?.code, 'tach-ignored-sources', 'respect_gitignore = false leaves .git/info/exclude on: the listing is its');
  assert.equal(ignoredRefusal(undefined, found, off, {})?.code, 'tach-ignored-sources-unknown');
  assert.equal(ignoredRefusal([], found, off, {}), undefined);
  assert.equal(ignoredRefusal([], tree([], { ignoreFiles: ['.ignore'] }), off, {}), undefined, 'tach switches .ignore off with respect_gitignore = false');
  assert.equal(ignoredRefusal(['src/a/x.py'], found, off, { allowIgnoredSources: true }), undefined);
});

test('symbolic links under a source root are named, unless excluded, outside the roots, or accepted', () => {
  const facts = readConfig('source_roots = ["src"]\nexclude = ["src/vendor"]\n');
  const links = tree([], { symlinks: ['src/a', 'src/b/x.py', 'src/vendor/v', 'tools/t'] });
  assert.deepEqual(symlinkedSources(links, facts), ['src/a', 'src/b/x.py']);
  assert.equal(symlinkRefusal(links, facts, {})?.code, 'tach-symlinked-sources');
  assert.equal(symlinkRefusal(links, facts, { allowIgnoredSources: true }), undefined);
  assert.equal(symlinkRefusal(tree([], { symlinks: ['tools/t'] }), facts, {}), undefined);
});

test('globs: gitignore-style patterns tach uses for exclude', () => {
  const m = (pattern: string, path: string) => globToRegExp(pattern).test(path);
  assert.ok(m('**/tests', 'src/a/tests/x.py') && m('**/tests', 'tests/x.py') && !m('**/tests', 'src/attests/x.py'));
  assert.ok(m('a', 'src/a') && m('a', 'a/b.py') && !m('a', 'src/ab'));
  assert.ok(m('src/a', 'src/a/x.py') && !m('src/a', 'other/src/a'));
  assert.ok(m('*.py', 'x.py') && m('/build', 'build/x') && !m('/build', 'src/build'));
  assert.deepEqual(excludedModules(readConfig('source_roots = ["src"]\nexclude = ["src/a"]\n[[modules]]\npath = "a"\n[[modules]]\npath = "b.c"\n')), ['a']);
});

test('a tach.domain.toml [root] is a module with the same keys, named by the file that defines it', () => {
  const domain = readConfig('[root]\nunchecked = true\n[[modules]]\npath = "service"\ndepends_on = []\n', 'domain');
  assert.deepEqual(domain.modules.map(m => [m.paths, m.unchecked]), [[['service'], false], [['<root>'], true]]);
  const merged = mergeDomain(readConfig('source_roots = ["src"]\n'), domain, 'src/a');
  assert.deepEqual(merged.modules.map(m => m.paths), [['src/a::service'], ['src/a::<root>']]);
  assert.match(configRefusal(['undeclared-dependency'], merged, EMPTY, {})?.detail ?? '', /unchecked.*src\/a::<root>/u);
  assert.deepEqual(excludedModules(mergeDomain(readConfig('exclude = ["service"]\n'), domain, 'src/a')), [], 'domain paths are relative to the domain, never matched against exclude');
  assert.deepEqual(readConfig('[root]\nunchecked = true\n').modules, [], 'a [root] table means nothing in tach.toml itself');
});

test('exclude: no key means nothing is excluded (tach 0.35 has no default list)', () => {
  assert.deepEqual(readConfig('').exclude, []);
  assert.deepEqual(excludedSources(tree(['tests/t.py', 'docs/d.py', 'venv/v.py']), readConfig('[[modules]]\npath = "tests"\n')), []);
});

test('excluded sources: files a declared module owns; others only when tach checks unowned code', () => {
  const files = tree(['src/a/__init__.py', 'src/a/legacy/x.py', 'src/a/impl.py', 'src/b.py', 'src/c/y.py', 'tests/t.py']);
  const config = (exclude: string, extra = ''): ReturnType<typeof readConfig> =>
    readConfig(`${extra}source_roots = ["src"]\nexclude = [${exclude}]\n[[modules]]\npath = "a"\n[[modules]]\npath = "b"\n`);
  assert.deepEqual(excludedSources(files, config('"src/a/legacy"')), ['src/a/legacy/x.py']);
  assert.deepEqual(excludedSources(files, config('"**/impl.py"')), ['src/a/impl.py']);
  assert.deepEqual(excludedSources(files, config('"src/b.py"')), ['src/b.py'], 'a module that is a single file');
  assert.deepEqual(excludedSources(files, config('"src/c"')), [], 'owned by no module and root_module is ignore');
  assert.deepEqual(excludedSources(files, config('"src/c"', 'root_module = "forbid"\n')), ['src/c/y.py'], 'unowned code is checked under forbid');
  assert.deepEqual(excludedSources(files, config('"tests"', 'root_module = "allow"\n')), [], 'outside every source root');
  const unchecked = readConfig('source_roots = ["src"]\nexclude = ["src/a/legacy"]\n[[modules]]\npath = "a"\nunchecked = true\n');
  assert.deepEqual(excludedSources(files, unchecked), [], 'an unchecked module is already refused on its own');
  const domain = mergeDomain(readConfig('source_roots = ["src"]\nexclude = ["src/a/legacy"]\n'), readConfig('[[modules]]\npath = "legacy"\ndepends_on = []\n', 'domain'), 'src/a');
  assert.deepEqual(excludedSources(files, domain), ['src/a/legacy/x.py'], 'a module a tach.domain.toml defines');
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
