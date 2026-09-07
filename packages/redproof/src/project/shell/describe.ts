import type { LoadedProject } from '../core/discovery.ts';
import { describeModule, type GateDescription } from '../core/description.ts';
import { loadProject, selectGateModules } from './loader.ts';

export async function describeProject(
  configPath: string,
  gateFiles: readonly string[] = [],
): Promise<{
  readonly project: LoadedProject;
  readonly descriptions: readonly GateDescription[];
}> {
  const project = await loadProject(configPath);
  const modules = await selectGateModules(project, gateFiles);

  return {
    project,
    descriptions: modules.map(describeModule),
  };
}
