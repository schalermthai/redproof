import {
  breach,
  counting,
  defineGate,
  defineProofs,
  defineRules,
  json,
  locate,
  mutate,
  proof,
  result,
} from 'redproof';

const rules = defineRules({
  testCommand: {
    id: 'config/test-command',
    description: 'The configured test command must use Node test runner.',
  },
});

const gate = defineGate({
  id: 'test-command',
  rules,
  check: {
    description: 'read the configured test command from JSON',
    counting: counting.supported,

    async run(ctx) {
      const found = await json.query(ctx, {
        files: 'config/policy.json',
        path: '$.scripts.test',
      });

      const breaches = found.matches
        .filter(match => match.value !== 'node --test')
        .map(match => breach(rules.testCommand, {
          code: 'wrong-test-command',
          message: 'Test command does not use the Node test runner.',
          location: { file: match.file, line: null, column: null },
          comparison: {
            expected: 'node --test',
            actual: String(match.value),
          },
        }));

      return result.fromBreaches(found.scan(), breaches);
    },
  },
});

export const proofs = defineProofs(gate, [
  proof.red(
    rules.testCommand,
    'detects a changed JSON test command',
    mutate.jsonSet(
      locate.json({ files: 'config/policy.json', path: '$.scripts.test' }),
      'echo broken',
    ),
  ),
  proof.green('accepts the configured Node test runner'),
]);

export default gate;
