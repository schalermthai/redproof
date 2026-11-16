export type StepFailure = {
  readonly code: string;
  readonly message: string;
  readonly detail?: string | undefined;
};

export type CosmicRayStep = 'baseline' | 'init' | 'exec' | 'dump';

/** Name what went wrong with a step that exited non-zero, without blaming the tests for a tool or config problem. */
export function classifyStepFailure(step: CosmicRayStep, exitCode: number, stdout: string, stderr: string): StepFailure {
  const output = `exit code: ${exitCode}\n${stderr}\n${stdout}`.trim();
  if (/No module named '?cosmic_ray/u.test(output)) {
    return { code: 'cosmic-ray-not-installed', message: 'The Python interpreter has no cosmic-ray installed.', detail: output };
  }
  if (exitCode === 78) {
    return { code: 'cosmic-ray-config-invalid', message: 'cosmic-ray could not load its configuration.', detail: output };
  }
  if (step === 'baseline' && exitCode === 1 && /Baseline failed/u.test(output)) {
    return { code: 'cosmic-ray-baseline-failed', message: 'The test suite fails on unmutated code, so every mutant would look killed.', detail: output };
  }
  return { code: 'cosmic-ray-producer-unsuccessful', message: `cosmic-ray ${step} did not complete successfully.`, detail: output };
}
