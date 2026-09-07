export type CommandExitCodes = {
  /** Exit codes that produce PASS. Defaults to `[0]`. */
  readonly pass?: readonly number[];
  /** Exit codes that breach the Rule. Defaults to every nonzero code not classified as PASS. */
  readonly breach?: readonly number[] | 'nonzero';
};

export type ExitPolicy = {
  readonly pass: ReadonlySet<number>;
  readonly breach: ReadonlySet<number> | 'nonzero';
};

export type ExitClass = 'pass' | 'breach' | 'unclassified';

function validateExitCode(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must contain only non-negative integers.`);
  }
}

export function exitPolicy(options: CommandExitCodes | undefined): ExitPolicy {
  const passCodes = options?.pass ?? [0];
  const breachCodes = options?.breach ?? 'nonzero';

  for (const code of passCodes) validateExitCode('exitCodes.pass', code);
  if (breachCodes !== 'nonzero') {
    for (const code of breachCodes) validateExitCode('exitCodes.breach', code);
  }

  const pass = new Set(passCodes);
  if (breachCodes !== 'nonzero') {
    for (const code of breachCodes) {
      if (pass.has(code)) {
        throw new Error(`Exit code ${code} cannot produce both PASS and a Breach.`);
      }
    }
  }

  return {
    pass,
    breach: breachCodes === 'nonzero' ? breachCodes : new Set(breachCodes),
  };
}

export function classifyExit(exitCode: number, policy: ExitPolicy): ExitClass {
  if (policy.pass.has(exitCode)) return 'pass';
  const isBreach = policy.breach === 'nonzero' ? exitCode !== 0 : policy.breach.has(exitCode);
  return isBreach ? 'breach' : 'unclassified';
}
