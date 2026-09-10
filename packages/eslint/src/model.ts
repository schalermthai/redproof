import { relative } from 'node:path';
import {
  breach,
  type Breach,
  type Diagnostic,
  type Rule,
  type RuleRef,
} from 'redproof';

export type EslintMessage = {
  readonly ruleId: string | null;
  readonly message: string;
  readonly line?: number | undefined;
  readonly column?: number | undefined;
  readonly fatal?: boolean | undefined;
};

export type EslintResult = {
  readonly filePath: string;
  readonly messages: readonly EslintMessage[];
};

export function eslintDiagnostic(root: string, file: string, message: EslintMessage): Diagnostic {
  return {
    code: message.ruleId ?? 'eslint-fatal',
    message: message.message,
    location: {
      file: relative(root, file),
      line: message.line ?? null,
      column: message.column ?? null,
    },
  };
}

export function fatalEslintDiagnostic(
  root: string,
  results: readonly EslintResult[],
): Diagnostic | null {
  for (const result of results) {
    const fatal = result.messages.find(message => message.fatal);
    if (fatal) return eslintDiagnostic(root, result.filePath, fatal);
  }
  return null;
}

export function eslintBreaches<R extends RuleRef>(
  root: string,
  results: readonly EslintResult[],
  byForeignId: ReadonlyMap<string, Rule<R>>,
): readonly Breach<R>[] {
  const breaches: Breach<R>[] = [];

  for (const result of results) {
    for (const message of result.messages) {
      if (!message.ruleId) continue;
      const rule = byForeignId.get(message.ruleId);
      if (!rule) continue;
      breaches.push(breach(rule, eslintDiagnostic(root, result.filePath, message)));
    }
  }

  return breaches;
}
