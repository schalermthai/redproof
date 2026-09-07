/**
 * Reject option names that are not part of `Shape`.
 *
 * A function written as `f<const O extends Shape>(options: O)` infers `O` from
 * the object literal, so TypeScript checks the inferred type against `Shape`
 * instead of checking the literal. An unknown option is then accepted and
 * silently ignored at run time. Intersecting the parameter with this type
 * gives every extra key the type `never`, so the literal is rejected.
 */
export type NoUnknownKeys<T, Shape> = {
  readonly [K in Exclude<keyof T, keyof Shape>]: never;
};

/**
 * Reject option names that are not in `allowed`.
 *
 * `NoUnknownKeys` guards the compiler. This guards the run time, which matters
 * because Redproof strips types and never checks them when it loads a project.
 */
export function rejectUnknownKeys(
  value: object,
  allowed: readonly string[],
  where: string,
): void {
  const unknown = Object.keys(value).filter(key => !allowed.includes(key));
  if (unknown.length === 0) return;

  throw new Error(
    `Unknown ${where} ${unknown.length === 1 ? 'option' : 'options'}: `
    + `${unknown.map(key => JSON.stringify(key)).join(', ')}. `
    + `Known options: ${allowed.join(', ')}.`,
  );
}
