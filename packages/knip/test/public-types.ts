import { knip } from '../src/index.ts';

function publicTypes() {
  const adapter = knip({ rules: { unused: 'exports' } });
  const id: 'knip/unused-exports' = adapter.rules.unused.id;
  // @ts-expect-error Unknown option keys are rejected for TypeScript consumers.
  knip({ rules: { unused: 'exports' }, unknown: true });
  // @ts-expect-error Foreign categories must be supported Knip issue types.
  knip({ rules: { unused: 'unusedEverything' } });
  // @ts-expect-error Category selection cannot fabricate a different Rule id.
  const wrong: 'knip/unused-files' = id;
  // @ts-expect-error Native categories are selectors, not generated Rule IDs.
  const legacy: 'knip/exports' = id;
  void legacy;
  return wrong;
}
void publicTypes;
