export function parse(input: string) {
  return { status: input.length > 0 ? 'valid' : 'invalid', input };
}
