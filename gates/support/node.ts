/** This Node binary. Gates run the same runtime that runs Redproof. */
export const node = process.execPath;

/** Run a TypeScript file directly, with types stripped and not checked. */
export function stripTypes(...args: readonly string[]): string[] {
  return ['--disable-warning=ExperimentalWarning', '--experimental-strip-types', ...args];
}

/** Run the workspace TypeScript compiler. */
export function tsc(...args: readonly string[]): string[] {
  return ['node_modules/typescript/bin/tsc', ...args];
}
