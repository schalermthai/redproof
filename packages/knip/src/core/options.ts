import { isAbsolute } from 'node:path';
import { rejectUnknownKeys } from 'redproof';
import { issueTypes, type KnipIssueType } from './model.ts';

export type Selection = Readonly<Record<string, KnipIssueType>>;

export type KnipOptions<M extends Selection = Selection> = {
  readonly rules: M;
  readonly cwd?: string;
  readonly configFile?: string;
  /** A Node CLI entry relative to the Gate root; defaults to the project's installed Knip. */
  readonly cli?: string;
  readonly workspace?: string;
  readonly production?: boolean;
  readonly strict?: boolean;
  readonly includeEntryExports?: boolean;
  readonly treatConfigHintsAsErrors?: boolean;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
};

function validatePath(name: string, value: string | undefined): void {
  if (value !== undefined && (typeof value !== 'string' || !value.trim()
    || isAbsolute(value) || /^[A-Za-z]:/u.test(value) || value.split(/[\\/]/u).includes('..'))) {
    throw new Error(`Knip ${name} must be a non-empty relative path inside the Gate root.`);
  }
}

export function validateKnipOptions(options: KnipOptions): void {
  rejectUnknownKeys(options, ['rules', 'cwd', 'configFile', 'cli', 'workspace', 'production',
    'strict', 'includeEntryExports', 'treatConfigHintsAsErrors', 'timeoutMs', 'maxOutputBytes'], 'knip adapter');
  const entries = Object.entries(options.rules);
  if (!entries.length) throw new Error('Knip requires at least one Redproof rule.');
  for (const [alias, type] of entries) {
    if (!alias.trim() || !issueTypes.includes(type)) throw new Error(`Unknown Knip issue type: ${type}.`);
  }
  if (new Set(entries.map(([, type]) => type)).size !== entries.length) {
    throw new Error('Knip issue types must not be selected more than once.');
  }
  for (const name of ['cwd', 'configFile', 'cli'] as const) validatePath(name, options[name]);
  if (options.workspace !== undefined && (typeof options.workspace !== 'string'
    || !options.workspace.trim() || options.workspace.startsWith('-'))) {
    throw new Error('Knip workspace must be a non-empty selector, not an option.');
  }
  for (const name of ['production', 'strict', 'includeEntryExports', 'treatConfigHintsAsErrors'] as const) {
    if (options[name] !== undefined && typeof options[name] !== 'boolean') throw new Error(`Knip ${name} must be boolean.`);
  }
  for (const name of ['timeoutMs', 'maxOutputBytes'] as const) {
    const value = options[name];
    if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) throw new Error(`Knip ${name} must be a positive integer.`);
  }
}
