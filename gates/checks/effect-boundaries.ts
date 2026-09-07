import {
  breach,
  type Adapter,
  type Breach,
  type Check,
  type Rule,
  type RuleCatalog,
  type RuleRef,
  type RuleRefOfCatalog,
} from 'redproof';
import { analyzeEffects, analyzePureTestEffects, type EffectFinding } from '../support/effects-model.ts';
import { readSources, type SourceFile } from '../support/sources.ts';
import { scanning } from '../support/scanning.ts';

export type EffectBoundaryRules<R extends RuleRef> = {
  readonly coreNoAmbientInputs: Rule<R>;
  readonly effectsAllowlistedBoundaries: Rule<R>;
  readonly coreTestsNoIoHelpers: Rule<R>;
};

export type EffectBoundaryOptions<E extends RuleRef, C extends RuleCatalog> = {
  /** Source files scanned for effect imports and ambient reads. */
  readonly sources: string;
  /** Functional-core tests that must stay free of input and output helpers. */
  readonly coreTests: string;
  readonly rules: EffectBoundaryRules<E>;
  /** Dependency rules are evaluated first, and their breaches are carried. */
  readonly dependencies: Adapter<C>;
};

type Scanned = {
  readonly sources: SourceFile[];
  readonly coreTests: SourceFile[];
};

function at<R extends RuleRef>(
  rule: Rule<R>,
  code: string,
  message: string,
  finding: EffectFinding,
): Breach<R> {
  return breach(rule, {
    code,
    message,
    location: { file: finding.file, line: finding.line, column: finding.column },
  });
}

/**
 * Source dependencies plus functional-core effect boundaries, as one Check.
 *
 * The dependency Adapter answers first. Its breaches are carried, so one Gate
 * reports both the module graph and the effect scan.
 */
export function effectBoundaries<E extends RuleRef, C extends RuleCatalog>(
  options: EffectBoundaryOptions<E, C>,
): Check<E | RuleRefOfCatalog<C>> {
  const { rules, dependencies } = options;
  const dependencyRuleIds = Object.values(dependencies.rules).map(rule => rule.id);

  return scanning<E | RuleRefOfCatalog<C>, Scanned>({
    description: 'enforce source dependencies and functional-core effect boundaries',
    source: 'dependency-cruiser + TypeScript effect scan',

    delegate: root => dependencies.check.run({ root, rules: dependencyRuleIds }),

    gather: async root => ({
      sources: await readSources(root, options.sources),
      coreTests: await readSources(root, options.coreTests),
    }),

    inspected: scanned => scanned.sources.length + scanned.coreTests.length,

    breaches: (scanned): Breach<E | RuleRefOfCatalog<C>>[] => {
      const effects = analyzeEffects(scanned.sources);
      const found: Breach<E | RuleRefOfCatalog<C>>[] = [];

      for (const finding of effects.coreAmbientInputs) {
        found.push(at(rules.coreNoAmbientInputs, 'ambient-input',
          `${finding.effect} is used outside its approved imperative boundary.`, finding));
      }
      for (const finding of effects.unapprovedBoundaries) {
        found.push(at(rules.effectsAllowlistedBoundaries, 'effect-import',
          `${finding.effect} is used outside its approved imperative boundary.`, finding));
      }
      for (const finding of analyzePureTestEffects(scanned.coreTests)) {
        found.push(at(rules.coreTestsNoIoHelpers, 'core-test-effect',
          `${finding.effect} is not available to functional-core tests.`, finding));
      }
      return found;
    },

    whenUnavailable: {
      code: 'effect-scan-unavailable',
      message: 'The source effect scan could not complete.',
    },
  });
}
