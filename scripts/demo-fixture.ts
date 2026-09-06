import { resolve } from 'node:path';
import { checkProject, formatRun } from 'redproof';

const fixture = process.argv[2];
if (!fixture) throw new Error('Usage: demo-fixture.ts <fixture>');

const run = await checkProject(resolve(`fixtures/${fixture}/redproof.config.ts`));
console.log(await formatRun(run, { color: process.stdout.isTTY }));
