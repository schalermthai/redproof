import { glob, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RedproofConfig } from '../../composition/config.ts';
import { resolveConfig } from '../../composition/config.ts';
import type { LoadedGateModule, LoadedProject } from '../core/discovery.ts';
import { gateFilesFrom, gateModuleFrom } from '../core/discovery.ts';
import { GateSelectionError, selectModules, unmatchedMessage } from '../core/selection.ts';

function freshImport(file: string): Promise<any> {
  return import(`${pathToFileURL(file).href}?redproof=${Date.now()}-${Math.random()}`);
}

export async function loadGateModule(file: string): Promise<LoadedGateModule> {
  return gateModuleFrom(file, await freshImport(file));
}

export async function loadProject(configPath: string): Promise<LoadedProject> {
  const absoluteConfig = resolve(configPath);
  const imported = await freshImport(absoluteConfig);
  const config = resolveConfig(imported.default as RedproofConfig);
  const projectRoot = resolve(dirname(absoluteConfig), config.root);

  const discovered: string[] = [];
  for (const pattern of config.gatesRoot) {
    for await (const file of glob(pattern, { cwd: projectRoot })) {
      discovered.push(resolve(projectRoot, file));
    }
  }

  const modules: LoadedGateModule[] = [];
  for (const file of gateFilesFrom(projectRoot, config.gatesRoot, discovered)) {
    modules.push(await loadGateModule(file));
  }

  return {
    root: projectRoot,
    refusalExit: config.refusalExit,
    execution: config.execution,
    modules,
  };
}

export async function selectGateModules(
  project: LoadedProject,
  gateFiles: readonly string[],
): Promise<readonly LoadedGateModule[]> {
  const selection = selectModules(project, gateFiles);
  if (selection.kind === 'selected') return selection.modules;

  const exists = await stat(selection.target).then(() => true, () => false);
  throw new GateSelectionError(unmatchedMessage(selection.gateFile, exists));
}
