import { isAbsolute } from 'node:path';
import { rejectUnknownKeys } from 'redproof';
import { ruleKinds, unreadableRules, type TachRuleKind } from './model.ts';

export type Selection = Readonly<Record<string, TachRuleKind>>;

export type TachOptions<M extends Selection = Selection> = {
  /** Alias to the kind of tach finding that must not occur. */
  readonly rules: M;
  /** The directory holding `tach.toml`, relative to the Gate root. Defaults to the Gate root. */
  readonly cwd?: string;
  /** The tach executable. Defaults to `tach` on PATH. */
  readonly command?: string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
};

function validatePath(name: string, value: string | undefined): void {
  if (value !== undefined && (typeof value !== 'string' || !value.trim() || value.startsWith('-')
    || isAbsolute(value) || /^[A-Za-z]:/u.test(value) || value.split(/[\\/]/u).includes('..'))) {
    throw new Error(`tach ${name} must be a non-empty relative path inside the Gate root.`);
  }
}

export function validateTachOptions(options: TachOptions): void {
  rejectUnknownKeys(options, ['rules', 'cwd', 'command', 'timeoutMs', 'maxOutputBytes'], 'tach adapter');
  const entries = Object.entries(options.rules ?? {});
  if (!entries.length) throw new Error('tach requires at least one Redproof rule.');
  for (const [alias, kind] of entries) {
    if (!alias.trim() || !(ruleKinds as readonly string[]).includes(kind)) {
      const why = unreadableRules[kind as string];
      throw new Error(`Unknown tach rule: ${String(kind)}.${why ? ` It cannot be checked: ${why}` : ''}`);
    }
  }
  if (new Set(entries.map(([, kind]) => kind)).size !== entries.length) {
    throw new Error('tach rules must not be selected more than once.');
  }
  validatePath('cwd', options.cwd);
  if (options.command !== undefined && (typeof options.command !== 'string' || !options.command.trim())) {
    throw new Error('tach command must not be empty.');
  }
  for (const name of ['timeoutMs', 'maxOutputBytes'] as const) {
    const value = options[name];
    if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) throw new Error(`tach ${name} must be a positive integer.`);
  }
}
