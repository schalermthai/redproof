export type RuleRef = string;

export type Rule<R extends RuleRef = RuleRef> = {
  readonly id: R;
  readonly description: string;
};

export type RuleCatalog = Readonly<Record<string, Rule>>;

export type RuleRefOfCatalog<C extends RuleCatalog> = C[keyof C]['id'];
