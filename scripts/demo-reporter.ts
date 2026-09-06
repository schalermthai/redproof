import { resolve } from 'node:path';
import { checkProject, renderCheckReporter, type CheckReporterName } from 'redproof';

const reporter = (process.argv[2] ?? 'default') as CheckReporterName;
const fixture = process.argv[3] ?? 'mixed';
const run = await checkProject(resolve(`fixtures/${fixture}/redproof.config.ts`));
console.log(await renderCheckReporter(reporter, run, { color: process.stdout.isTTY }));
