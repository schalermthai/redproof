import { resolve } from 'node:path';
import { checkProject, formatRun } from 'redproof';

const fixtures = [
  'pass-multi',
  'pass-single',
  'fail-single',
  'fail-multi-breach',
  'refuse',
  'non-countable',
  'mixed',
] as const;

for (const fixture of fixtures) {
  console.log(`\n===== ${fixture} =====\n`);
  const run = await checkProject(resolve(`fixtures/${fixture}/redproof.config.ts`));
  console.log(await formatRun(run, { color: process.stdout.isTTY }));
}
