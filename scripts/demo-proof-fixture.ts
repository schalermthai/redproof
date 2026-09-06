import { resolve } from 'node:path';
import { formatProof, proveProject } from 'redproof';

const fixture = process.argv[2];
if (!fixture) throw new Error('Usage: demo-proof-fixture.ts <fixture>');

const run = await proveProject(resolve(`fixtures/${fixture}/redproof.config.ts`));
for (const outcome of run.outcomes) console.log(formatProof(outcome));
