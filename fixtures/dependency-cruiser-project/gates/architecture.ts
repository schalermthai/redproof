import { dependencyCruiser } from '@redproof/dependency-cruiser';
import { defineGate, defineProofs, mutate, proof } from 'redproof';

const adapter = dependencyCruiser({
  configFile: '.dependency-cruiser.cjs',
  files: ['src'],
  rules: {
    domainNoInfrastructure: 'domain-no-infrastructure',
    applicationNoAdapters: 'application-no-adapters',
  },
});

const gate = defineGate({
  id: 'architecture',
  adapter,
});

export const proofs = defineProofs(gate, [
  proof.red(
    adapter.rules.domainNoInfrastructure,
    'detects domain importing infrastructure',
    mutate.appendText(
      'src/domain/order.js',
      "\nimport '../infrastructure/database.js';\n",
    ),
  ),
  proof.red(
    adapter.rules.applicationNoAdapters,
    'detects application importing adapters',
    mutate.appendText(
      'src/application/place-order.js',
      "\nimport '../adapters/http.js';\n",
    ),
  ),
  proof.green('accepts valid architecture'),
  proof.refuse(
    'refuses when dependency-cruiser configuration is unavailable',
    mutate.rename('.dependency-cruiser.cjs', '.dependency-cruiser.off.cjs'),
  ),
]);

export default gate;
