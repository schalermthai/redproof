import { posix } from 'node:path';
import { excludedModules, hiddenSources, type ConfigFacts } from './config.ts';
import type { TachRuleKind } from './model.ts';

export type GuardRefusal = { readonly code: string; readonly message: string; readonly detail: string };

export type GuardOptions = {
  /** Accept that a selected rule may have nothing configured to enforce. */
  readonly allowInactiveRules?: boolean | undefined;
  /** Accept that gitignored Python files under a source root are invisible to tach. */
  readonly allowIgnoredSources?: boolean | undefined;
};

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
    const excluded = excludedModules(facts);
    if (excluded.length) reasons.push(`\`exclude\` removes whole modules from the walk: ${excluded.join(', ')}.`);
  }
  if (kinds.includes('undeclared-dependency')) {
    const open = checked.filter(m => !m.hasDependsOn && !m.hasLayer).flatMap(m => m.paths);
    if (open.length) reasons.push(`modules with neither \`depends_on\` nor \`layer\` may import anything: ${open.join(', ')}.`);
  }
  if (kinds.includes('forbidden-dependency') && !checked.some(m => m.hasCannotDependOn)) reasons.push('forbidden-dependency: no module sets `cannot_depend_on`.');
  if (kinds.includes('deprecated-dependency') && !checked.some(m => m.hasDeprecated)) reasons.push('deprecated-dependency: no dependency is marked `deprecated = true`.');
  if (kinds.includes('layer-violation') && !facts.hasLayers) reasons.push('layer-violation: tach.toml defines no `layers`.');
  if (kinds.includes('interface-violation') && !facts.hasInterfaces) reasons.push('interface-violation: tach.toml defines no `[[interfaces]]`.');
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

/** Whether the ignored-file listing is needed at all. The one copy of this policy: the shell asks it before spawning git, the guard asks it before judging. */
export function needsIgnoredListing(facts: ConfigFacts, options: GuardOptions): boolean {
  return !options.allowIgnoredSources && facts.respectGitignore !== 'false';
}

export function ignoredRefusal(ignored: IgnoredFiles, facts: ConfigFacts, options: GuardOptions): GuardRefusal | undefined {
  if (!needsIgnoredListing(facts, options)) return undefined;
  if (ignored === undefined) {
    return { code: 'tach-ignored-sources-unknown', message: 'tach skips files that ignore files name, and git could not say which Python files those are.',
      detail: 'Install git, set `respect_gitignore = false` in tach.toml, or set allowIgnoredSources.' };
  }
  const hidden = hiddenSources(ignored, facts);
  return hidden.length
    ? { code: 'tach-ignored-sources', message: 'Ignore files hide Python files under a source root from tach, so a violation in them would pass.',
      detail: `${hidden.slice(0, 5).join('\n')}${hidden.length > 5 ? `\n... and ${hidden.length - 5} more` : ''}\nSet \`respect_gitignore = false\` in tach.toml, un-ignore them, or set allowIgnoredSources.` }
    : undefined;
}
