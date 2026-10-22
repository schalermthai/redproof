import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { DependencyCruiserConfig } from '../core/model.ts';
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

export type ConfigExtraction = {
  readonly config: DependencyCruiserConfig;
  readonly options: DependencyCruiserOptions;
};

export type ConfigWorkerJob = {
  readonly root: string;
  readonly configPath: string;
};

const configWorkerFile = import.meta.url.endsWith('.ts')
  ? new URL('./config-worker.ts', import.meta.url)
  : new URL('./config-worker.js', import.meta.url);

/** A fresh module cache also reloads configs reached through imports or extends. */
export function extractFreshConfig(root: string, configPath: string): Promise<ConfigExtraction> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(configWorkerFile, {
      workerData: { root, configPath } satisfies ConfigWorkerJob,
      execArgv: ['--disable-warning=ExperimentalWarning', '--experimental-strip-types'],
    });
    let settled = false;

    worker.once('message', (extracted: ConfigExtraction) => {
      settled = true;
      // Config modules may leave timers or other handles open. Do not retain
      // those handles (or the module cache) after returning the snapshot.
      void worker.terminate().then(() => resolve(extracted), reject);
    });
    worker.once('error', error => {
      settled = true;
      reject(error);
    });
    worker.once('exit', code => {
      if (!settled) reject(new Error(`dependency-cruiser config worker exited before returning a result (code=${code}).`));
    });
  });
}

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
