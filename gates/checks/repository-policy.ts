import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { breach, type Breach, type Check, type Rule, type RuleRef } from 'redproof';
import {
  evaluateRepositoryPolicy,
  type ManifestSnapshot,
  type RepositoryPolicyRule,
  type RepositorySnapshot,
} from '../support/repository-policy-model.ts';
import { listPaths, readSources } from '../support/sources.ts';
import { scanning } from '../support/scanning.ts';

/** One Rule per policy the model can report. */
export type RepositoryPolicyRules<R extends RuleRef> = Record<RepositoryPolicyRule, Rule<R>>;

export type RepositoryPolicyOptions<R extends RuleRef> = {
  readonly rules: RepositoryPolicyRules<R>;
  /** Paths that must exist for a relative documentation link to resolve. */
  readonly linkTargets: readonly string[];
  /** Documents whose relative links are followed. */
  readonly documents: readonly string[];
};

async function read(root: string, file: string): Promise<string> {
  return readFile(join(root, file), 'utf8');
}

async function manifests(root: string): Promise<ManifestSnapshot[]> {
  const found = await readSources(root, 'packages/*/package.json');

  return found.map(({ file, content }) => {
    const manifest = JSON.parse(content) as ManifestSnapshot['manifest'] & {
      name?: string;
      version?: string;
    };
    if (!manifest.name || !manifest.version) throw new Error(`${file} is missing name or version.`);
    return {
      file,
      dir: file.slice(0, -'/package.json'.length),
      name: manifest.name,
      version: manifest.version,
      manifest,
    };
  });
}

/** Package, release, public-surface, automation, and documentation contracts. */
export function repositoryPolicy<R extends RuleRef>(
  options: RepositoryPolicyOptions<R>,
): Check<R> {
  return scanning<R, RepositorySnapshot>({
    description: 'evaluate package, release, public-surface, automation, and documentation contracts',
    source: 'repository policy',

    gather: async root => {
      const rootManifest = JSON.parse(await read(root, 'package.json')) as {
        scripts?: Record<string, string>;
      };
      const documents = await Promise.all(
        options.documents.map(pattern => readSources(root, pattern)),
      );

      return {
        rootScripts: rootManifest.scripts ?? {},
        rootBuildScript: rootManifest.scripts?.build ?? '',
        manifests: await manifests(root),
        setVersionSource: await read(root, 'scripts/set-version.ts'),
        verifyPackageSource: await read(root, 'scripts/verify-package.ts'),
        ciWorkflow: await read(root, '.github/workflows/ci.yml'),
        publishWorkflow: await read(root, '.github/workflows/publish.yml'),
        existingPaths: await listPaths(root, options.linkTargets),
        markdown: [...new Map(documents.flat().map(doc => [doc.file, doc])).values()]
          .sort((left, right) => left.file.localeCompare(right.file)),
      };
    },

    inspected: state => state.manifests.length + state.markdown.length,

    breaches: (state): Breach<R>[] =>
      evaluateRepositoryPolicy(state).map(finding => breach(options.rules[finding.rule], {
        code: finding.code,
        message: finding.message,
        location: { file: finding.file, line: null, column: null },
        ...(finding.detail ? { detail: finding.detail } : {}),
      })),

    whenUnavailable: {
      code: 'repository-policy-unavailable',
      message: 'Repository policy inputs could not be read.',
    },
  });
}
