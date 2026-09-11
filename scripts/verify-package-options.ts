import { isAbsolute, relative, resolve, sep } from 'node:path';

export type PackageVerificationOptions = {
  readonly packDestination?: string;
};

export function pathIsInside(root: string, candidate: string): boolean {
  const relativeCandidate = relative(root, candidate);
  return relativeCandidate !== ''
    && relativeCandidate !== '..'
    && !relativeCandidate.startsWith(`..${sep}`)
    && !isAbsolute(relativeCandidate);
}

export function resolvePackageVerificationOptions(
  args: readonly string[],
  repositoryRoot: string,
): PackageVerificationOptions {
  let rawDestination: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const option = args[index]!;
    if (option !== '--pack-destination') {
      throw new Error(`Unknown option: ${option}`);
    }
    if (rawDestination !== undefined) {
      throw new Error('--pack-destination may be provided only once.');
    }

    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error('--pack-destination requires a path.');
    }
    rawDestination = value;
    index += 1;
  }

  if (rawDestination === undefined) return {};

  const packDestination = resolve(repositoryRoot, rawDestination);
  const relativeDestination = relative(repositoryRoot, packDestination);
  if (relativeDestination === '') {
    throw new Error('--pack-destination must not be the repository root.');
  }
  if (!pathIsInside(repositoryRoot, packDestination)) {
    throw new Error('--pack-destination must stay inside the repository.');
  }

  return { packDestination };
}
