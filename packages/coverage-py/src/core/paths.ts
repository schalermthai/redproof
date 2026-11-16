import { isAbsolute, posix, relative, resolve, sep } from 'node:path';

/** Confine a report path (relative to the directory coverage ran in) to the Gate root; returns the root-relative POSIX path. */
export function coveragePath(root: string, cwd: string, file: string): string {
  if (!file.trim() || file.includes('\0')) throw new Error('Invalid coverage.py file path.');
  const path = relative(root, resolve(cwd, file));
  if (!path || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) throw new Error('coverage.py file is outside the Gate root.');
  return path.split(sep).join(posix.sep);
}
