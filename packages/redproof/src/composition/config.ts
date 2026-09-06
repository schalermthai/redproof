export type InPlaceExecutionConfig = {
  readonly mode: 'in-place';
};

export type CopiesExecutionConfig = {
  readonly mode: 'copies';
  readonly maxAtOnce?: number;
};

export type ExecutionConfig = InPlaceExecutionConfig | CopiesExecutionConfig;

export type ResolvedExecutionConfig =
  | InPlaceExecutionConfig
  | { readonly mode: 'copies'; readonly maxAtOnce: number };

export type RedproofConfig = {
  readonly root?: string;
  readonly gatesRoot?: string | readonly string[];
  readonly refusalExit?: number;
  readonly execution?: ExecutionConfig;
};

export type ResolvedRedproofConfig = {
  readonly root: string;
  readonly gatesRoot: readonly string[];
  readonly refusalExit: number;
  readonly execution: ResolvedExecutionConfig;
};

export function defineConfig<const C extends RedproofConfig>(config: C): C {
  return config;
}

export function resolveConfig(config: RedproofConfig): ResolvedRedproofConfig {
  const gatesRoot = config.gatesRoot ?? 'gates/**/*.ts';

  const execution = config.execution ?? { mode: 'copies' as const };

  if (execution.mode === 'copies') {
    const maxAtOnce = execution.maxAtOnce ?? 4;
    if (!Number.isInteger(maxAtOnce) || maxAtOnce < 1) {
      throw new Error('execution.maxAtOnce must be a positive integer.');
    }

    return {
      root: config.root ?? '.',
      gatesRoot: typeof gatesRoot === 'string' ? [gatesRoot] : gatesRoot,
      refusalExit: config.refusalExit ?? 2,
      execution: { mode: 'copies', maxAtOnce },
    };
  }

  return {
    root: config.root ?? '.',
    gatesRoot: typeof gatesRoot === 'string' ? [gatesRoot] : gatesRoot,
    refusalExit: config.refusalExit ?? 2,
    execution: { mode: 'in-place' },
  };
}
