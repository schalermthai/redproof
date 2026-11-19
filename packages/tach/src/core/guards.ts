import { posix } from 'node:path';
import { hiddenSources, interfacesAnchored, layersAssigned, nestedRepositories, overlappingRoots, symlinkedSources, unsafeExcludes, type ConfigFacts, type SourceTree } from './config.ts';
import type { TachRuleKind } from './model.ts';

export type GuardRefusal = { readonly code: string; readonly message: string; readonly detail: string };

export type GuardOptions = {
  /** Accept that a selected rule may have nothing configured to enforce. */
  readonly allowInactiveRules?: boolean | undefined;
  /** Accept that tach may skip Python files under a source root: an ignore file, a nested repository, a symbolic link. */
  readonly allowIgnoredSources?: boolean | undefined;
  /** Accept an `exclude` that is more than environment and cache directories. */
  readonly allowExcludedSources?: boolean | undefined;
};

const list = (items: readonly string[]): string => `${items.slice(0, 5).join(', ')}${items.length > 5 ? `, and ${items.length - 5} more` : ''}`;

const IMPORT_RULES: readonly TachRuleKind[] = ['undeclared-dependency', 'forbidden-dependency', 'deprecated-dependency', 'layer-violation', 'interface-violation'];

/**
 * A rule the Gate selected must have its evidence switched on. tach prints a clean report for a rule whose
 * configuration is missing or off, so a clean report would otherwise pass for a rule that checked nothing.
 * `circular-dependency` has no opt-in: the check is a one-line setting, so the project turns it on.
 */
export function configRefusal(kinds: readonly TachRuleKind[], facts: ConfigFacts, options: GuardOptions): GuardRefusal | undefined {
  if (kinds.includes('circular-dependency') && !facts.forbidCircular) {
    return { code: 'tach-cycle-check-off', message: 'circular-dependency is selected but tach is not told to forbid circular dependencies, so it prints a clean report for a real cycle.',
      detail: 'Set `forbid_circular_dependencies = true` at the top level of tach.toml.' };
  }
  if (options.allowInactiveRules) return undefined;
  const reasons: string[] = [];
  const checked = facts.modules.filter(m => !m.unchecked);
  const importRule = kinds.some(k => IMPORT_RULES.includes(k));
  if (importRule) {
    if (facts.localImports === 'off') reasons.push('`[rules] local_imports = "off"` hides imports inside functions.');
    const unchecked = facts.modules.filter(m => m.unchecked).flatMap(m => m.paths);
    if (unchecked.length) reasons.push(`modules marked \`unchecked = true\` are not checked: ${unchecked.join(', ')}.`);
  }
  if (kinds.includes('undeclared-dependency')) {
    const open = checked.filter(m => (!m.hasDependsOn && !m.hasLayer) || m.dependsOnAnything).flatMap(m => m.paths);
    if (open.length) reasons.push(`modules with neither \`depends_on\` nor \`layer\`, or a \`depends_on\` that matches every module, may import anything: ${open.join(', ')}.`);
  }
  if (kinds.includes('forbidden-dependency') && !checked.some(m => m.hasCannotDependOn)) reasons.push('forbidden-dependency: no module sets `cannot_depend_on`.');
  if (kinds.includes('deprecated-dependency') && !checked.some(m => m.hasDeprecated)) reasons.push('deprecated-dependency: no dependency is marked `deprecated = true`.');
  if (kinds.includes('layer-violation')) {
    if (!facts.hasLayers) reasons.push('layer-violation: tach.toml defines no `layers`.');
    else if (!layersAssigned(facts)) reasons.push('layer-violation: no checked module sets `layer`, so the layers constrain nothing.');
  }
  if (kinds.includes('interface-violation')) {
    if (!facts.interfaceFrom.length) reasons.push('interface-violation: tach.toml defines no `[[interfaces]]`.');
    else if (!interfacesAnchored(facts)) reasons.push('interface-violation: no `[[interfaces]]` entry has a `from` that matches a checked module, so no interface applies.');
  }
  if (kinds.includes('visibility-violation') && !(checked.some(m => m.hasVisibility) || facts.hasInterfaceVisibility)) reasons.push('visibility-violation: no module or interface sets `visibility`.');
  if (kinds.includes('ignore-directive') && facts.unusedIgnoreDirectives === 'off') reasons.push('ignore-directive: `[rules] unused_ignore_directives = "off"`.');
  return reasons.length
    ? { code: 'tach-rule-inactive', message: 'A selected rule has nothing switched on to enforce, so a clean tach report would prove nothing. Fix the configuration or set allowInactiveRules.', detail: reasons.join('\n') }
    : undefined;
}

/** A source root that leaves the Gate root would let tach judge files the Gate never named. */
export function escapingRoots(roots: readonly string[]): readonly string[] {
  return roots.filter(root => {
    const normal = posix.normalize(root.replaceAll('\\', '/'));
    return posix.isAbsolute(normal) || /^[A-Za-z]:/u.test(root) || normal === '..' || normal.startsWith('../');
  });
}

/** What the shell learned about files the walker skips because of ignore files; undefined when it could not find out. */
export type IgnoredFiles = readonly string[] | undefined;

/**
 * Whether the ignored-file listing is needed at all. The one copy of this policy: the shell asks it before spawning
 * git, the guard asks it before judging. It is needed even with `respect_gitignore = false`, which does not switch
 * off `.git/info/exclude`.
 */
export function needsIgnoredListing(options: GuardOptions): boolean {
  return !options.allowIgnoredSources;
}

export function sourcesRefusal(ignored: IgnoredFiles, tree: SourceTree, facts: ConfigFacts, options: GuardOptions): GuardRefusal | undefined {
  // The adapter does not interpret tach's glob syntax, so an exclude entry that is not a plain environment or cache directory may remove code.
  const unsafe = unsafeExcludes(facts, tree);
  if (unsafe.length && !options.allowExcludedSources) {
    return { code: 'tach-ignored-sources', message: '`exclude` may remove first-party code from tach\'s walk, and the adapter does not interpret tach\'s glob syntax. `tach init` writes an exclude for tests and docs, so an initialised project lands here.',
      detail: `${list(unsafe.map(pattern => JSON.stringify(pattern)))}\nRemove those entries, or set allowExcludedSources to accept that tach skips those paths. Plain environment and cache entries (.venv, venv, node_modules, __pycache__, .git, .tox, build, dist, egg-info) are not refused.` };
  }
  if (!needsIgnoredListing(options)) return undefined;
  // git does not show the ignore files of a repository nested in this one.
  const nested = nestedRepositories(tree, facts);
  if (nested.length) {
    return { code: 'tach-ignored-sources-unknown', message: 'A repository nested in the project has ignore files that the outer git does not show, so no one can say which Python files tach skips.',
      detail: `${list(nested)}\nRemove the nested repository or set allowIgnoredSources.` };
  }
  // tach reads `.ignore` like a `.gitignore` (unless respect_gitignore is false), and git does not, so the listing cannot say what it hides.
  if (facts.respectGitignore !== 'false' && tree.ignoreFiles.length) {
    return { code: 'tach-ignored-sources', message: 'A .ignore file is read by tach but not by git, so no one can say which Python files it hides from tach.',
      detail: `${list(tree.ignoreFiles)}\nRemove it, set \`respect_gitignore = false\` in tach.toml (which switches it off), or set allowIgnoredSources.` };
  }
  if (ignored === undefined) {
    return { code: 'tach-ignored-sources-unknown', message: 'tach skips files that ignore files name, and git could not say which Python files those are.',
      detail: 'git is missing, cannot open a repository here (for example dubious ownership), or an ignore file sits above the repository where git does not look. Fix that, or set allowIgnoredSources.' };
  }
  const hidden = hiddenSources(ignored, tree, facts);
  return hidden.length
    ? { code: 'tach-ignored-sources', message: 'Ignore files hide Python files under a source root from tach, so a violation in them would pass.',
      detail: `${hidden.slice(0, 5).join('\n')}${hidden.length > 5 ? `\n... and ${hidden.length - 5} more` : ''}\nUn-ignore them, set \`respect_gitignore = false\` in tach.toml (it does not switch off .git/info/exclude), or set allowIgnoredSources.` }
    : undefined;
}

/** tach does not follow symbolic links, so a module reached through one is never read and no diagnostic says so. */
export function symlinkRefusal(tree: SourceTree, facts: ConfigFacts, options: GuardOptions): GuardRefusal | undefined {
  if (options.allowIgnoredSources) return undefined;
  const links = symlinkedSources(tree, facts);
  return links.length
    ? { code: 'tach-symlinked-sources', message: 'A symbolic link under a source root is not followed by tach, so the code behind it is never checked.',
      detail: `${list(links)}\nReplace the link with the real directory or file, exclude it knowingly, or set allowIgnoredSources.` }
    : undefined;
}

/** Source roots tach would walk twice, or that cannot be told apart: its result is then random, so there is no opt-out. */
export function overlapRefusal(facts: ConfigFacts): GuardRefusal | undefined {
  const overlap = overlappingRoots(facts);
  return overlap.length
    ? { code: 'tach-overlapping-source-roots', message: 'Overlapping source roots make tach drop findings at random, so the same project can PASS on one run and FAIL on the next.',
      detail: `${list(overlap)}\nUse source roots that do not contain each other, with no glob beside another root.` }
    : undefined;
}
