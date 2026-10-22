import { dependencyCruiser } from '@redproof/dependency-cruiser';
import { defineGate, defineProofs, locate, mutate, proof } from 'redproof';

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
  proof.refuse(
    'refuses a corrupt dependency-cruiser configuration after earlier checks',
    mutate.writeText('.dependency-cruiser.cjs', 'module.exports = { forbidden: [ };\n'),
  ),
  proof.refuse(
    'refuses when a selected rule is disabled after earlier checks',
    mutate.replaceText(
      locate.text({ files: '.dependency-cruiser.cjs', find: "severity: 'error'", occurrence: 'first' }),
      "severity: 'ignore'",
    ),
  ),
  proof.refuse(
    'refuses when selected rules are removed after earlier checks',
    mutate.writeText('.dependency-cruiser.cjs', 'module.exports = { forbidden: [] };\n'),
  ),
  proof.red(
    adapter.rules.applicationNoAdapters,
    'detects a changed rule boundary after earlier checks',
    mutate.replaceText(
      locate.text({ files: '.dependency-cruiser.cjs', find: "to: { path: '^src/adapters' }" }),
      "to: { path: '^src/domain' }",
    ),
  ),
  proof.green('accepts restored configuration after config mutations'),
]);

export default gate;
