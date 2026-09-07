import type { Mutation, UndoMutation } from '../../../domain/index.ts';
import { mutationContext, type MutationContext } from './context.ts';

export type ManualMutationDefinition = {
  readonly description: string;
  apply(ctx: MutationContext): Promise<UndoMutation>;
};

export type CapturedMutationDefinition = {
  readonly description: string;
  readonly capture: string | readonly string[];
  apply(ctx: MutationContext): Promise<void>;
};

export function defineMutation(definition: ManualMutationDefinition | CapturedMutationDefinition): Mutation {
  return {
    description: definition.description,
    async apply(root) {
      const ctx = mutationContext(root);

      if ('capture' in definition) {
        const undo = await ctx.capture(definition.capture);
        try {
          await definition.apply(ctx);
          return undo;
        } catch (error) {
          await undo();
          throw error;
        }
      }

      return definition.apply(ctx);
    },
  };
}
