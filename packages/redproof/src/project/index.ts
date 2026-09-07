export type { LoadedGateModule, LoadedProject } from './core/discovery.ts';
export type { DescribedProof, DescribedRule, GateDescription } from './core/description.ts';
export { describeLoadedProject } from './core/description.ts';
export { GateSelectionError } from './core/selection.ts';
export { loadGateModule, loadProject, selectGateModules } from './shell/loader.ts';
export { describeProject } from './shell/describe.ts';
