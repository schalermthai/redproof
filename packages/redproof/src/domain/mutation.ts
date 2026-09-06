export type UndoMutation = () => Promise<void>;

export type Mutation = {
  readonly description: string;
  apply(root: string): Promise<UndoMutation>;
};

export type MutationPlan = Mutation | readonly Mutation[];
