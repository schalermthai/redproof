import { parentPort, workerData } from 'node:worker_threads';
import { loadDependencyCruiser, type ConfigExtraction, type ConfigWorkerJob } from './tool.ts';

const { root, configPath } = workerData as ConfigWorkerJob;
const tool = await loadDependencyCruiser(root);
const config = await tool.extractConfig(configPath);
const options = await tool.extractOptions(configPath);

parentPort!.postMessage({ config, options } satisfies ConfigExtraction);
