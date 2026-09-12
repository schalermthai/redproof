import assert from 'node:assert/strict';
import test from 'node:test';
import { incompleteEslintDiagnostic } from '../../packages/eslint/src/model.ts';

const result = (message: string, extra: Record<string, unknown> = {}) => [{
  filePath: '/repo/src/a.js',
  messages: [{ ruleId: null, message, ...extra }],
}];

test('a target ESLint refused to inspect is incomplete evidence', () => {
  for (const notice of [
    'File ignored because of a matching ignore pattern. Use "--no-ignore" to disable file ignore settings.',
    'File ignored because no matching configuration was supplied.',
    'File ignored because outside of base path.',
    'File ignored by default. Use "--no-ignore" to override.',
  ]) {
    assert.deepEqual(
      incompleteEslintDiagnostic('/repo', result(notice)),
      {
        code: 'eslint-incomplete-evidence',
        message: notice,
        location: { file: 'src/a.js', line: null, column: null },
      },
      notice,
    );
  }
});

test('ESLint directive bookkeeping is not a target ESLint refused to inspect', () => {
  for (const notice of [
    "Unused eslint-disable directive (no problems were reported from 'no-console').",
    'Unused eslint-disable directive (no problems were reported).',
    "Unused eslint-enable directive (no matching eslint-disable directives were found for 'no-console').",
    "Unused inline config ('no-console' is already configured to 'error').",
  ]) {
    assert.equal(incompleteEslintDiagnostic('/repo', result(notice)), null, notice);
  }
});

test('an unknown Rule-less diagnostic still refuses, so new ESLint output cannot pass silently', () => {
  assert.equal(
    incompleteEslintDiagnostic('/repo', result('Something ESLint has not reported before.'))?.code,
    'eslint-incomplete-evidence',
  );
});

test('a fatal parse error stays with the fatal diagnostic, not the incomplete one', () => {
  assert.equal(
    incompleteEslintDiagnostic('/repo', result('Parsing error: Unexpected token', { fatal: true })),
    null,
  );
});
