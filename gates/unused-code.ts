import { knip } from '@redproof/knip';
import { defineGate, defineProofs, locate, mutate, proof } from 'redproof';

const adapter = knip({
  configFile: 'knip.json',
  rules: { files: 'files', exports: 'exports', dependencies: 'dependencies',
    devDependencies: 'devDependencies', unlisted: 'unlisted', unresolved: 'unresolved' },
});
const gate = defineGate({ id: 'unused-code', adapter });

export const proofs = defineProofs(gate, [
  proof.red(adapter.rules.files, 'finds an unreachable implementation file',
    mutate.writeText('packages/knip/src/unused-receipt.ts', 'export const unusedReceipt = 1;\n')),
  proof.red(adapter.rules.exports, 'finds an unused internal export',
    mutate.appendText('packages/knip/src/model.ts', '\nexport const unusedReceipt = 1;\n')),
  proof.red(adapter.rules.dependencies, 'finds a dependency without consumers',
    mutate.jsonMerge(locate.json({ files: 'packages/knip/package.json', path: '$.dependencies' }), { 'unused-receipt': '1.0.0' })),
  proof.red(adapter.rules.devDependencies, 'finds a dev dependency without consumers',
    mutate.jsonMerge(locate.json({ files: 'packages/knip/package.json', path: '$.devDependencies' }), { 'unused-receipt': '1.0.0' })),
  proof.red(adapter.rules.unlisted, 'finds an undeclared external dependency',
    mutate.appendText('packages/knip/src/model.ts', "\nimport 'redproof-undeclared-receipt';\n")),
  proof.red(adapter.rules.unresolved, 'finds an unresolved internal import',
    mutate.appendText('packages/knip/src/model.ts', "\nimport './redproof-missing-receipt.ts';\n")),
  proof.refuse('refuses incomplete Knip configuration', mutate.writeText('knip.json', '{ invalid')),
  proof.green('accepts the maintained repository inventory'),
]);

export default gate;
