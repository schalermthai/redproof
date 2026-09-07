import type { ResolvedExecutionConfig } from '../../composition/core/index.ts';

export type ExecutionPolicy =
  | {
      readonly mode: 'in-place';
      readonly maxAtOnce: 1;
      readonly workspace: 'original';
      readonly process: 'coordinator';
    }
  | {
      readonly mode: 'copies';
      readonly maxAtOnce: number;
      readonly workspace: 'gate-copy';
      readonly process: 'child';
    };

/** Pure projection from project configuration to runtime execution policy. */
export function executionPolicy(config: ResolvedExecutionConfig): ExecutionPolicy {
  if (config.mode === 'in-place') {
    return {
      mode: 'in-place',
      maxAtOnce: 1,
      workspace: 'original',
      process: 'coordinator',
    };
  }

  return {
    mode: 'copies',
    maxAtOnce: config.maxAtOnce,
    workspace: 'gate-copy',
    process: 'child',
  };
}
