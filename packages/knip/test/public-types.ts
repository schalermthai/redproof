import { knip } from '../src/index.ts';

function publicTypes() {
  const adapter = knip({ rules: { unused: 'exports' } });
  const id: 'knip/exports' = adapter.rules.unused.id;
  // @ts-expect-error Unknown option keys are rejected for TypeScript consumers.
  knip({ rules: { unused: 'exports' }, unknown: true });
  // @ts-expect-error Foreign categories must be supported Knip issue types.
  knip({ rules: { unused: 'unusedEverything' } });
  // @ts-expect-error Category selection cannot fabricate a different Rule id.
  const wrong: 'knip/files' = id;
  return wrong;
}
void publicTypes;
