import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  parseKnownViolations,
  parseSelfManifest,
  selfExport,
  type PackageManifest,
} from '../core/outcome.ts';

export type DependencyCruiserModules = {
  readonly cruise: typeof import('dependency-cruiser').cruise;
  readonly extractConfig: typeof import('dependency-cruiser/config-utl/extract-depcruise-config').default;
  readonly extractOptions: typeof import('dependency-cruiser/config-utl/extract-depcruise-options').default;
};

type DependencyCruiserOptions = NonNullable<
  Parameters<DependencyCruiserModules['cruise']>[1]
>;
export type KnownViolations = NonNullable<DependencyCruiserOptions['knownViolations']>;

export function now(): string {
  return new Date().toISOString();
}

export function withCwd<T>(root: string, action: () => Promise<T>): Promise<T> {
  const before = process.cwd();
  process.chdir(root);
  return action().finally(() => process.chdir(before));
}

async function selfManifest(root: string): Promise<PackageManifest | null> {
  const text = await readFile(resolve(root, 'package.json'), 'utf8').catch(() => null);
  return parseSelfManifest(text);
}

export async function loadDependencyCruiser(root: string): Promise<DependencyCruiserModules> {
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

export async function readKnownViolations(path: string): Promise<KnownViolations | Error> {
  const text = await readFile(path, 'utf8').catch(
    (error: NodeJS.ErrnoException) => error,
  );
  if (text instanceof Error) return new Error(`Cannot read ${path}. ${text.message}`);
  return parseKnownViolations(path, text) as KnownViolations | Error;
}
