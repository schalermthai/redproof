import { sep } from 'node:path';

export const requiredKnip = 'This adapter requires Knip >=6.35.1 <7.';

/** The Knip package root that holds a CLI path, when that path is inside an installed Knip. */
export function knipPackageRootOf(cli: string): string | undefined {
  const parts = cli.split(sep);
  const index = parts.lastIndexOf('knip');
  if (index < 1 || parts[index - 1] !== 'node_modules') return undefined;
  return parts.slice(0, index + 1).join(sep);
}

/** The installed version when the manifest states one outside the supported range, otherwise undefined. */
export function unsupportedVersion(manifestText: string): string | undefined {
  const manifest = JSON.parse(manifestText) as { version?: string };
  const version = /^6\.(\d+)\.(\d+)$/u.exec(manifest.version ?? '');
  if (!version || Number(version[1]) < 35 || (Number(version[1]) === 35 && Number(version[2]) < 1)) {
    return `Installed: ${manifest.version ?? 'unknown'}`;
  }
  return undefined;
}
