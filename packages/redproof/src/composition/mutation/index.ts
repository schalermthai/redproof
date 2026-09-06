export type { MutationContext } from './context.ts';
export type { ManualMutationDefinition, CapturedMutationDefinition } from './define.ts';
export { defineMutation } from './define.ts';
export type { JsonValue } from './json.ts';

import { filesystemMutations } from './filesystem.ts';
import { jsonMutations } from './json.ts';
import { textMutations } from './text.ts';

export const mutate = {
  ...filesystemMutations,
  ...textMutations,
  ...jsonMutations,
};
