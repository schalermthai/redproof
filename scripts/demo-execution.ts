import { resolve } from 'node:path';
import { checkProject, formatRun } from 'redproof';

const fixture = process.argv[2] ?? 'execution-copies-parallel';
const run = await checkProject(resolve(`fixtures/${fixture}/redproof.config.ts`));
console.log(await formatRun(run, { color: process.stdout.isTTY }));
console.log('');
console.log(`Coordinator PID: ${process.pid}`);
console.log(`Execution: ${run.project.execution.mode}`);
for (const item of run.results) {
  console.log(`  ${item.module.gate.id}: worker PID ${item.workerPid} (${item.result.scan.source})`);
}
