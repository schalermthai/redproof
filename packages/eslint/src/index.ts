import { ESLint } from 'eslint';
import { relative } from 'node:path';
import {
  breach,
  counting,
  defineAdapter,
  defineRules,
  result,
  type Adapter,
  type Breach,
  type Diagnostic,
  type Rule,
} from 'redproof';

type EslintRuleInput = Readonly<Record<string, string>>;

type EslintRuleCatalog<M extends EslintRuleInput> = {
  readonly [K in keyof M]: Rule<`eslint/${M[K] & string}`>;
};

export type EslintAdapterOptions<M extends EslintRuleInput> = {
  readonly files?: readonly string[];
  readonly rules: M;
};

function now(): string {
  return new Date().toISOString();
}

type LintMessageLike = {
  readonly ruleId: string | null;
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
};

function messageDiagnostic(file: string, message: LintMessageLike): Diagnostic {
  return {
    code: message.ruleId ?? 'eslint-fatal',
    message: message.message,
    location: {
      file,
      line: message.line ?? null,
      column: message.column ?? null,
    },
  };
}

export function eslint<const M extends EslintRuleInput>(
  options: EslintAdapterOptions<M>,
): Adapter<EslintRuleCatalog<M>> {
  type Catalog = EslintRuleCatalog<M>;
  type Ref = Catalog[keyof Catalog]['id'];

  const rules = defineRules(Object.fromEntries(
    Object.entries(options.rules).map(([alias, foreignId]) => [
      alias,
      {
        id: `eslint/${foreignId}`,
        description: `ESLint rule ${foreignId} must hold.`,
      },
    ]),
  ) as Catalog);

  const byForeignId = new Map<string, Rule<Ref>>();
  for (const [alias, foreignId] of Object.entries(options.rules)) {
    byForeignId.set(foreignId, rules[alias as keyof M] as Rule<Ref>);
  }

  const lintFiles = [...(options.files ?? ['.'])];

  return defineAdapter({
    kind: 'eslint',
    rules,
    check: {
      description: `run ESLint against ${lintFiles.join(', ')} and report configured rule breaches`,
      counting: counting.supported,

      async run(ctx) {
        const startedAt = now();

        try {
          const engine = new ESLint({
            cwd: ctx.root,
            overrideConfig: {
              rules: Object.fromEntries(
                Object.values(options.rules).map(ruleId => [ruleId, 'error']),
              ),
            },
          });

          const lintResults = await engine.lintFiles(lintFiles);
          const finishedAt = now();
          const scan = {
            source: 'eslint',
            startedAt,
            finishedAt,
            inspected: lintResults.length,
          } as const;

          for (const lintResult of lintResults) {
            const fatal = lintResult.messages.find(message => message.fatal);
            if (fatal) {
              return result.refuse(
                scan,
                messageDiagnostic(relative(ctx.root, lintResult.filePath), fatal),
              );
            }
          }

          const breaches: Breach<Ref>[] = [];
          for (const lintResult of lintResults) {
            for (const message of lintResult.messages) {
              if (!message.ruleId) continue;
              const rule = byForeignId.get(message.ruleId);
              if (!rule) continue;
              breaches.push(
                breach(
                  rule,
                  messageDiagnostic(relative(ctx.root, lintResult.filePath), message),
                ),
              );
            }
          }

          return result.fromBreaches(scan, breaches);
        } catch (error) {
          const finishedAt = now();
          return result.refuse(
            {
              source: 'eslint',
              startedAt,
              finishedAt,
              inspected: null,
            },
            {
              code: 'eslint-unavailable',
              message: 'ESLint could not complete the check.',
              location: null,
              detail: error instanceof Error ? error.message : String(error),
            },
          );
        }
      },
    },
  });
}
