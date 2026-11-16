import assert from 'node:assert/strict';
import test from 'node:test';
import { excludedModules, globToRegExp, hiddenSources, mergeDomain, readConfig, statements } from '../src/core/config.ts';
import { configRefusal, escapingRoots, ignoredRefusal } from '../src/core/guards.ts';
import type { TachRuleKind } from '../src/core/model.ts';

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

test('statements: headers, pairs, comments and strings are told apart', () => {
  assert.deepEqual(statements('# c\n[rules]\nlocal_imports = "off" # why\n[[modules]]\npath = "a#b"\n'), [
    { kind: 'header', name: 'rules', array: false },
    { kind: 'pair', key: 'local_imports', value: '"off"' },
    { kind: 'header', name: 'modules', array: true },
    { kind: 'pair', key: 'path', value: '"a#b"' },
  ]);
});

test('facts: layers, interfaces, rules (table or inline), respect_gitignore, source roots', () => {
  const facts = readConfig(`respect_gitignore = false\nsource_roots = ["src", "lib"]\nlayers = ["ui", { name = "core", closed = true }]\nrules = { local_imports = "off" }\n[rules]\n[[interfaces]]\nexpose = ["x"]\nfrom = ["b"]\n${MODULES}`);
  assert.equal(facts.respectGitignore, 'false');
  assert.deepEqual(facts.sourceRoots, ['src', 'lib']);
  assert.equal(facts.hasLayers, true);
  assert.equal(facts.hasInterfaces, true);
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

const everything = 'forbid_circular_dependencies = true\nlayers = ["h", "l"]\n[[interfaces]]\nexpose = ["x"]\nfrom = ["b"]\n[[modules]]\npath = "a"\ndepends_on = [{ path = "b", deprecated = true }]\ncannot_depend_on = ["c"]\nvisibility = ["z"]\n[[modules]]\npath = "b"\ndepends_on = []\n';
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
  ['undeclared-dependency', everything.replace('depends_on = []\n', ''), /neither `depends_on` nor `layer` may import anything: b/u],
  ['undeclared-dependency', `[rules]\nlocal_imports = "off"\n${everything}`, /local_imports/u],
  ['undeclared-dependency', everything.replace('path = "b"\n', 'path = "b"\nunchecked = true\n'), /unchecked/u],
  ['undeclared-dependency', `exclude = ["b"]\n${everything}`, /whole modules.*b/u],
  ['layer-violation', `exclude = ["src/a"]\nsource_roots = ["src"]\n${everything}`, /whole modules.*a/u],
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

test('ignored sources: only first-party Python under a source root that tach would otherwise read', () => {
  const facts = readConfig('source_roots = ["src"]\n');
  assert.deepEqual(hiddenSources(['src/a/x.py', 'src/.venv/lib/y.py', 'src/node_modules/z.py', 'tools/t.py', 'src/a/readme.txt', 'src/a/__pycache__/x.py', 'src/tests/t.py'], facts), ['src/a/x.py']);
  assert.deepEqual(hiddenSources(['x.py', 'a/y.py'], readConfig('')), ['x.py', 'a/y.py'], 'default source root is the project');
  assert.deepEqual(hiddenSources(['src/gen/x.py'], readConfig('source_roots = ["src"]\nexclude = ["src/gen"]\n')), [], 'an excluded path is skipped by tach anyway');
});

test('ignoredRefusal: hidden files, unknown, opt-in, respect_gitignore = false', () => {
  const facts = readConfig('source_roots = ["src"]\n');
  assert.equal(ignoredRefusal(['src/a/x.py'], facts, {})?.code, 'tach-ignored-sources');
  assert.equal(ignoredRefusal(undefined, facts, {})?.code, 'tach-ignored-sources-unknown');
  assert.equal(ignoredRefusal([], facts, {}), undefined);
  assert.equal(ignoredRefusal(['src/a/x.py'], facts, { allowIgnoredSources: true }), undefined);
  assert.equal(ignoredRefusal(['src/a/x.py'], readConfig('respect_gitignore = false\n'), {}), undefined);
  assert.equal(ignoredRefusal(undefined, readConfig('respect_gitignore = false\n'), {}), undefined);
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
  const domain = readConfig('[root]\nunchecked = true\n[[modules]]\npath = "service"\ndepends_on = []\n');
  assert.deepEqual(domain.modules.map(m => [m.paths, m.unchecked]), [[['<root>'], true], [['service'], false]]);
  const merged = mergeDomain(readConfig('source_roots = ["src"]\n'), domain, 'src/a');
  assert.deepEqual(merged.modules.map(m => m.paths), [['src/a::<root>'], ['src/a::service']]);
  assert.match(configRefusal(['undeclared-dependency'], merged, {})?.detail ?? '', /unchecked.*src\/a::<root>/u);
  assert.deepEqual(excludedModules(mergeDomain(readConfig('exclude = ["service"]\n'), domain, 'src/a')), [], 'domain paths are relative to the domain, never matched against exclude');
});
