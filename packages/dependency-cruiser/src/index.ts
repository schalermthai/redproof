import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import {
  counting,
  defineAdapter,
  defineRules,
  result,
  type Adapter,
  type Rule,
} from 'redproof';
import {
  violationsToBreaches,
  type DependencyCruiserViolation,
} from './model.ts';

type DependencyCruiserRuleInput = Readonly<Record<string, string>>;

type DependencyCruiserRuleCatalog<M extends DependencyCruiserRuleInput> = {
  readonly [K in keyof M]: Rule<`dependency-cruiser/${M[K] & string}`>;
};

export type DependencyCruiserAdapterOptions<M extends DependencyCruiserRuleInput> = {
  readonly files?: readonly string[];
  readonly configFile?: string;
  readonly knownViolationsFile?: string;
  readonly rules: M;
};

type DependencyCruiserModules = {
  readonly cruise: typeof import('dependency-cruiser').cruise;
  readonly extractConfig: typeof import('dependency-cruiser/config-utl/extract-depcruise-config').default;
  readonly extractOptions: typeof import('dependency-cruiser/config-utl/extract-depcruise-options').default;
};

type DependencyCruiserOptions = NonNullable<
  Parameters<DependencyCruiserModules['cruise']>[1]
>;
type KnownViolations = NonNullable<DependencyCruiserOptions['knownViolations']>;

type PackageExport = string | {
  readonly import?: string;
  readonly default?: string;
};

type PackageManifest = {
  readonly name?: string;
  readonly exports?: Readonly<Record<string, PackageExport>>;
};

type DependencyCruiserConfig = {
  readonly forbidden?: readonly { readonly name?: string }[];
  readonly required?: readonly { readonly name?: string }[];
  readonly allowed?: readonly unknown[];
};

type CruiseOutputLike = {
  readonly summary?: {
    readonly totalCruised?: number;
    readonly violations?: readonly DependencyCruiserViolation[];
  };
};

// dependency-cruiser returns a JSON string for outputType 'json'.
function readCruiseOutput(output: unknown): CruiseOutputLike | null {
  if (typeof output === 'string') {
    try {
      return JSON.parse(output) as CruiseOutputLike;
    } catch {
      return null;
    }
  }

  return typeof output === 'object' && output !== null
    ? output as CruiseOutputLike
    : null;
}

function now(): string {
  return new Date().toISOString();
}

function configuredRuleNames(config: DependencyCruiserConfig): ReadonlySet<string> {
  return new Set([
    ...(config.forbidden ?? []).flatMap(rule => rule.name ? [rule.name] : []),
    ...(config.required ?? []).flatMap(rule => rule.name ? [rule.name] : []),
    ...((config.allowed?.length ?? 0) > 0 ? ['not-in-allowed'] : []),
  ]);
}

function withCwd<T>(root: string, action: () => Promise<T>): Promise<T> {
  const before = process.cwd();
  process.chdir(root);
  return action().finally(() => process.chdir(before));
}

function selfExport(manifest: PackageManifest, subpath: string): string {
  const exported = manifest.exports?.[subpath];
  const target = typeof exported === 'string'
    ? exported
    : exported?.import ?? exported?.default;
  if (!target) {
    throw new Error(`dependency-cruiser does not export ${subpath}.`);
  }
  return target;
}

async function selfManifest(root: string): Promise<PackageManifest | null> {
  const manifest = await readFile(resolve(root, 'package.json'), 'utf8')
    .then(text => JSON.parse(text) as PackageManifest, () => null);
  return manifest?.name === 'dependency-cruiser' ? manifest : null;
}

async function loadDependencyCruiser(root: string): Promise<DependencyCruiserModules> {
  const manifest = await selfManifest(root);

  if (manifest) {
    const loadSelf = (subpath: string) => import(pathToFileURL(
      resolve(root, selfExport(manifest, subpath)),
    ).href);
    const [main, config, options] = await Promise.all([
      loadSelf('.'),
      loadSelf('./config-utl/extract-depcruise-config'),
      loadSelf('./config-utl/extract-depcruise-options'),
    ]);
    return {
      cruise: main.cruise as DependencyCruiserModules['cruise'],
      extractConfig: config.default as DependencyCruiserModules['extractConfig'],
      extractOptions: options.default as DependencyCruiserModules['extractOptions'],
    };
  }

  const [main, config, options] = await Promise.all([
    import('dependency-cruiser'),
    import('dependency-cruiser/config-utl/extract-depcruise-config'),
    import('dependency-cruiser/config-utl/extract-depcruise-options'),
  ]);
  return {
    cruise: main.cruise,
    extractConfig: config.default,
    extractOptions: options.default,
  };
}

async function readKnownViolations(path: string): Promise<KnownViolations | Error> {
  const text = await readFile(path, 'utf8').catch(
    (error: NodeJS.ErrnoException) => error,
  );
  if (text instanceof Error) return new Error(`Cannot read ${path}. ${text.message}`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return new Error(`${path} is not valid JSON. ${(error as Error).message}`);
  }

  if (!Array.isArray(parsed)) {
    return new Error(`${path} must hold a JSON array of known violations.`);
  }
  return parsed as KnownViolations;
}

export function dependencyCruiser<const M extends DependencyCruiserRuleInput>(
  options: DependencyCruiserAdapterOptions<M>,
): Adapter<DependencyCruiserRuleCatalog<M>> {
  type Catalog = DependencyCruiserRuleCatalog<M>;
  type Ref = Catalog[keyof Catalog]['id'];

  const rules = defineRules(Object.fromEntries(
    Object.entries(options.rules).map(([alias, foreignName]) => [
      alias,
      {
        id: `dependency-cruiser/${foreignName}`,
        description: `dependency-cruiser rule ${foreignName} must hold.`,
      },
    ]),
  ) as Catalog);

  const byForeignRule = new Map<string, Rule<Ref>>();
  for (const [alias, foreignName] of Object.entries(options.rules)) {
    byForeignRule.set(foreignName, rules[alias as keyof M] as Rule<Ref>);
  }

  const files = [...(options.files ?? ['src'])];
  const configFile = options.configFile ?? '.dependency-cruiser.cjs';

  return defineAdapter({
    kind: 'dependency-cruiser',
    rules,
    check: {
      description: `run dependency-cruiser against ${files.join(', ')} and report configured rule breaches`,
      counting: counting.supported,

      async run(ctx) {
        const startedAt = now();

        try {
          return await withCwd(ctx.root, async () => {
            const dependencyCruiser = await loadDependencyCruiser(ctx.root);
            const configPath = resolve(ctx.root, configFile);
            const config = await dependencyCruiser.extractConfig(configPath) as DependencyCruiserConfig;
            const available = configuredRuleNames(config);
            const missing = Object.values(options.rules).filter(name => !available.has(name));

            if (missing.length > 0) {
              return result.refuse(
                {
                  source: 'dependency-cruiser',
                  startedAt,
                  finishedAt: now(),
                  inspected: null,
                },
                {
                  code: 'dependency-cruiser-rule-missing',
                  message: 'Configured Redproof rules are missing from the dependency-cruiser configuration.',
                  location: { file: configFile, line: null, column: null },
                  detail: `Missing: ${missing.join(', ')}`,
                },
              );
            }

            const cruiseOptions = await dependencyCruiser.extractOptions(configPath);
            const baselineFile = options.knownViolationsFile;
            const knownViolations = baselineFile
              ? await readKnownViolations(resolve(ctx.root, baselineFile))
              : undefined;

            if (knownViolations instanceof Error) {
              return result.refuse(
                {
                  source: 'dependency-cruiser',
                  startedAt,
                  finishedAt: now(),
                  inspected: null,
                },
                {
                  code: 'dependency-cruiser-known-violations-invalid',
                  message: 'The known-violations baseline could not be read.',
                  location: { file: baselineFile!, line: null, column: null },
                  detail: knownViolations.message,
                },
              );
            }
            const cruiseResult = await dependencyCruiser.cruise(
              files,
              {
                ...cruiseOptions,
                cache: false,
                ...(knownViolations ? { ignoreKnown: true, knownViolations } : {}),
                outputType: 'json',
              },
            );

            const output = readCruiseOutput(cruiseResult.output);
            if (!output?.summary || !Array.isArray(output.summary.violations)) {
              return result.refuse(
                {
                  source: 'dependency-cruiser',
                  startedAt,
                  finishedAt: now(),
                  inspected: null,
                },
                {
                  code: 'dependency-cruiser-output-unreadable',
                  message: 'dependency-cruiser completed without a trustworthy structured result.',
                  location: null,
                },
              );
            }

            const scan = {
              source: 'dependency-cruiser',
              startedAt,
              finishedAt: now(),
              inspected: output.summary.totalCruised ?? null,
            } as const;

            return result.fromBreaches(
              scan,
              violationsToBreaches(output.summary.violations, byForeignRule),
            );
          });
        } catch (error) {
          return result.refuse(
            {
              source: 'dependency-cruiser',
              startedAt,
              finishedAt: now(),
              inspected: null,
            },
            {
              code: 'dependency-cruiser-unavailable',
              message: 'dependency-cruiser could not complete the check.',
              location: null,
              detail: error instanceof Error ? error.message : String(error),
            },
          );
        }
      },
    },
  });
}

export type { DependencyCruiserViolation } from './model.ts';
