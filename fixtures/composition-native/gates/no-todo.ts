import {
  breach,
  counting,
  defineGate,
  defineProofs,
  defineRules,
  locate,
  mutate,
  proof,
  result,
  text,
} from 'redproof';

const rules = defineRules({
  noTodo: {
    id: 'source/no-todo',
    description: 'Source files must not contain TODO comments.',
  },
});

const gate = defineGate({
  id: 'no-todo',
  rules,
  check: {
    description: 'scan TypeScript source files for TODO comments',
    counting: counting.supported,

    async run(ctx) {
      const startedAt = new Date().toISOString();
      const found = await text.find(ctx, {
        files: 'src/**/*.ts',
        find: /\bTODO\b/g,
      });
      const scan = {
        source: 'text',
        startedAt,
        finishedAt: new Date().toISOString(),
        inspected: found.files.length,
      } as const;

      return result.fromBreaches(
        scan,
        found.matches.map(match => breach(rules.noTodo, {
          code: 'todo-found',
          message: 'TODO comment found.',
          location: match.location,
        })),
      );
    },
  },
});

export const proofs = defineProofs(gate, [
  proof.red(
    rules.noTodo,
    'detects a TODO inserted beside existing code',
    mutate.insertAfter(
      locate.text({
        files: 'src/example.ts',
        find: 'export const answer = 42;',
      }),
      '\n// TODO: remove proof marker',
    ),
  ),
  proof.green('accepts clean source'),
]);

export default gate;
