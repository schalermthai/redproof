import assert from 'node:assert/strict';
import test from 'node:test';
import type { CheckResult, CompletedProofOutcome, GateDescription, ProofOutcome } from 'redproof';
import {
  formatCheck,
  formatGateDescription,
  formatProof,
  renderRun,
} from '../../packages/redproof/src/reporter/core/terminal.ts';
import { at, breach, fail, gate, pass, refuse, rule, run, unsupported } from './runs.ts';

const R1 = rule('unit/r1', 'R1');
const noSources = new Map<string, readonly string[]>();

/** Everything before the clock-dependent "Start at" row. */
function beforeStart(output: string): string {
  return output.slice(0, output.indexOf('\n Start at'));
}

function single(result: CheckResult, id = 'unit') {
  return run([gate({ id, rules: [R1], result })]);
}

test('a single passing Gate is expanded down to its held Rules', () => {
  const output = renderRun(single(pass()), noSources);

  assert.equal(beforeStart(output), [
    ' ✓ gates/unit.ts (1 rule) 3ms',
    '   ✓ r1',
    '',
    '',
    ' Gates      1 passed (1)',
    ' Rules      1 held (1)',
  ].join('\n'));
});

test('many passing Gates stay compact unless verbose is requested', () => {
  const gates = ['a', 'b', 'c'].map(id => gate({ id, rules: [R1, rule('unit/r2')], result: pass() }));

  const compact = renderRun(run(gates), noSources);
  assert.match(compact, /^ ✓ gates\/a\.ts \(2 rules\) 3ms\n ✓ gates\/b\.ts \(2 rules\) 3ms\n ✓ gates\/c\.ts \(2 rules\) 3ms\n\n\n Gates/);
  assert.doesNotMatch(compact, /✓ r1/);
  assert.match(compact, /\n Gates      3 passed \(3\)\n Rules      6 held \(6\)\n Start at/);

  const verbose = renderRun(run(gates), noSources, { verbose: true });
  assert.match(verbose, /^ ✓ gates\/a\.ts \(2 rules\) 3ms\n   ✓ r1\n   ✓ r2\n ✓ gates\/b\.ts/);
});

test('an allowed zero-inspection PASS is visible on the Gate line, an unknown count is not', () => {
  assert.match(renderRun(single(pass(0)), noSources), /^ ✓ gates\/unit\.ts \(1 rule \| 0 inspected\) 3ms\n/);
  assert.match(renderRun(single(pass(null)), noSources), /^ ✓ gates\/unit\.ts \(1 rule\) 3ms\n/);
});

test('a failed Gate expands its Rules, details the Breach with its evidence, and counts it', () => {
  const rules = [
    rule('parser/accepts-valid-input'),
    rule('parser/rejects-malformed-input'),
    rule('parser/preserves-whitespace'),
  ];
  const malformed = breach(rules[1]!, 'Malformed input was accepted.', at('src/parser.ts', 2, 30), {
    code: 'unexpected-status',
    comparison: { expected: 'invalid', actual: 'valid' },
    detail: 'The parser returned a value.',
    hint: 'Reject malformed tokens first.',
  });
  const sources = new Map([['src/parser.ts', ['export function parse(input) {', '  return { ok: true, value: input };', '}']]]);

  const output = renderRun(run([gate({ id: 'parser', rules, result: fail(malformed) })]), sources);

  assert.equal(beforeStart(output), [
    ' ❯ gates/parser.ts (3 rules | 1 breached | 1 breach) 3ms',
    '   ✓ accepts-valid-input',
    '   ❯ rejects-malformed-input',
    '     × 1 breach',
    '   ✓ preserves-whitespace',
    '',
    '',
    ' FAIL  gates/parser.ts > rejects-malformed-input',
    '',
    ' ❯ src/parser.ts:2:30',
    '',
    '     1| export function parse(input) {',
    '     2|   return { ok: true, value: input };',
    '      |                              ^',
    '     3| }',
    '',
    '   Malformed input was accepted.',
    '',
    '   Expected: invalid',
    '   Received: valid',
    '',
    '   The parser returned a value.',
    '',
    '   Hint: Reject malformed tokens first.',
    '',
    '',
    ' Gates      1 failed (1)',
    ' Rules      2 held | 1 breached (3)',
    ' Breaches   1',
  ].join('\n'));
});

test('several Breaches are grouped under their Rule, in catalog order, with a count header', () => {
  const domain = rule('architecture/domain-no-infrastructure');
  const application = rule('architecture/application-no-adapters');
  const result = fail(
    breach(application, 'application imports an adapter'),
    breach(domain, 'domain imports fs'),
    breach(domain, 'domain imports http'),
  );

  const output = renderRun(run([gate({ id: 'architecture', rules: [domain, application], result })]), noSources);

  assert.match(output, /^ ❯ gates\/architecture\.ts \(2 rules \| 2 breached \| 3 breaches\) 3ms\n/);
  assert.match(output, /   ❯ domain-no-infrastructure\n     × 2 breaches\n   ❯ application-no-adapters\n     × 1 breach\n/);
  assert.match(output, / FAIL  gates\/architecture\.ts > domain-no-infrastructure\n\n2 breaches\n\n   domain imports fs\n\n   domain imports http\n/);
  assert.match(output, / FAIL  gates\/architecture\.ts > application-no-adapters\n\n   application imports an adapter\n/);
  assert.ok(output.indexOf('> domain-no-infrastructure') < output.indexOf('> application-no-adapters'));
  assert.match(output, /\n Rules      2 breached \(2\)\n Breaches   3\n/);
});

test('a REFUSE is reported apart from Rule breaches and leaves its Rules undecided', () => {
  const why = { code: 'eslint-config', message: 'ESLint configuration could not be loaded.', location: null };
  const output = renderRun(run([gate({ id: 'eslint', rules: [rule('eslint/no-console'), rule('eslint/no-var')], result: refuse(why) })]), noSources);

  assert.equal(beforeStart(output), [
    ' ! gates/eslint.ts (2 rules | refused) 3ms',
    '',
    '',
    ' REFUSE  gates/eslint.ts',
    '',
    '   ESLint configuration could not be loaded.',
    '',
    '   The Check could not make a trustworthy PASS or FAIL decision.',
    '',
    '',
    ' Gates      1 refused (1)',
    ' Rules      2 undecided (2)',
  ].join('\n'));
});

test('a non-countable FAIL never invents exact totals or held Rules', () => {
  const clean = rule('stryker/clean');
  const complete = rule('stryker/complete');
  const result = fail(breach(clean, 'a mutant survived'));

  const output = renderRun(run([gate({ id: 'stryker', rules: [clean, complete], counting: unsupported, result })]), noSources);

  assert.match(output, /^ ❯ gates\/stryker\.ts \(2 rules \| breach detected\) 3ms\n/);
  assert.match(output, /   ❯ clean\n     × breach detected\n   \? complete \(not established\)\n/);
  assert.doesNotMatch(output, /\d+ breaches/);
  assert.match(output, /\n Rules      1\+ breached \| 1 unknown \(2\)\n Breaches   not countable\n/);
});

test('a mixed run summarizes PASS, FAIL, and REFUSE together', () => {
  const rules = [rule('a/one'), rule('a/two'), rule('a/three')];
  const output = renderRun(run([
    gate({ id: 'passing', rules: rules.slice(0, 2), result: pass() }),
    gate({ id: 'failing', rules, result: fail(breach(rules[0]!, 'x'), breach(rules[0]!, 'y')) }),
    gate({ id: 'refusing', rules: rules.slice(0, 2), result: refuse({ code: 'c', message: 'm', location: null }) }),
  ]), noSources);

  assert.match(output, /^ ✓ gates\/passing\.ts \(2 rules\) 3ms\n ❯ gates\/failing\.ts \(3 rules \| 1 breached \| 2 breaches\) 3ms\n   ❯ one\n/);
  assert.match(output, /\n ! gates\/refusing\.ts \(2 rules \| refused\) 3ms\n/);
  assert.match(output, /\n Gates      1 passed \| 1 failed \| 1 refused \(3\)\n Rules      4 held \| 1 breached \| 2 undecided \(7\)\n Breaches   2\n/);
});

test('durations are shown in the unit that fits them', () => {
  const output = renderRun(run([
    gate({ id: 'fast', rules: [R1], result: pass(), durationMs: 0.4 }),
    gate({ id: 'quick', rules: [R1], result: pass(), durationMs: 12.4 }),
    gate({ id: 'slow', rules: [R1], result: pass(), durationMs: 1500 }),
  ], { durationMs: 1512.8 }), noSources);

  assert.match(output, /gates\/fast\.ts \(1 rule\) <1ms\n/);
  assert.match(output, /gates\/quick\.ts \(1 rule\) 12ms\n/);
  assert.match(output, /gates\/slow\.ts \(1 rule\) 1\.50s\n/);
  assert.match(output, /\n Duration   1\.51s$/);
});

test('colour is off unless asked for, and then wraps the verdict glyphs', () => {
  const plain = renderRun(single(pass()), noSources);
  assert.doesNotMatch(plain, /\[/);

  const coloured = renderRun(single(pass()), noSources, { color: true });
  assert.match(coloured, /^ \[32m✓\[0m gates\/unit\.ts /);
});

const breachAt = (line: number | null, column: number | null) => fail(breach(R1, 'R1 breached', at('src/a.ts', line, column), { code: 'r1' }));
const fourLines = ['const a = 1;', 'const b = 2;', 'const c = 3;', 'const d = 4;'];

test('a source excerpt clamps its window at the file start and marks the column', () => {
  const output = renderRun(single(breachAt(1, 3)), new Map([['src/a.ts', fourLines]]), { sourceContext: 2 });

  assert.match(output, / ❯ src\/a\.ts:1:3\n\n     1\| const a = 1;\n      \|   \^\n     2\| const b = 2;\n     3\| const c = 3;\n\n   R1 breached/);
  assert.doesNotMatch(output, /const d = 4/);
});

test('a source excerpt clamps its window at the file end and pads line numbers to the widest', () => {
  const twelveLines = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`);
  const output = renderRun(single(breachAt(12, null)), new Map([['src/a.ts', twelveLines]]), { sourceContext: 1 });

  assert.match(output, / ❯ src\/a\.ts:12\n\n     11\| line 11\n     12\| line 12\n\n   R1 breached/);
  assert.doesNotMatch(output, /\^/);
});

test('a missing source shows the location without an excerpt', () => {
  const output = renderRun(single(breachAt(7, null)), noSources);

  assert.match(output, / ❯ src\/a\.ts:7\n\n   R1 breached/);
  assert.doesNotMatch(output, /\n\s+\d+\| /);
});

test('a diagnostic without a line never asks for source', () => {
  const output = renderRun(single(breachAt(null, null)), new Map([['src/a.ts', ['ignored']]]));

  assert.match(output, / ❯ src\/a\.ts\n\n   R1 breached/);
  assert.doesNotMatch(output, /ignored/);
});

test('a located refusal shows its excerpt under the REFUSE heading', () => {
  const why = { code: 'parse', message: 'Config is not valid JSON.', location: at('.eslintrc.json', 2, 1) };
  const output = renderRun(single(refuse(why)), new Map([['.eslintrc.json', ['{', '  "extends": [,', '}']]]));

  assert.match(output, / REFUSE  gates\/unit\.ts\n\n ❯ \.eslintrc\.json:2:1\n\n     1\| \{\n     2\|   "extends": \[,\n      \| \^\n     3\| \}\n\n   Config is not valid JSON\.\n/);
});

test('formatCheck gives one line per verdict with the breaches or the reason beneath', () => {
  assert.equal(formatCheck('g', pass()), 'PASS g');
  assert.equal(
    formatCheck('g', fail(breach('a/x', 'first'), breach('a/y', 'second'))),
    'FAIL g\n  a/x: first\n  a/y: second',
  );
  assert.equal(
    formatCheck('g', refuse({ code: 'unavailable', message: 'No input', location: null })),
    'REFUSE g\n  unavailable: No input',
  );
});

function completed<E extends CompletedProofOutcome['expected']>(
  expected: E,
  reason: Extract<CompletedProofOutcome, { expected: E }>['reason'],
  result: CheckResult,
): ProofOutcome {
  return { status: 'completed', gate: 'lint', proof: 'a var is flagged', expected, reason, result, workerPid: 1 } as CompletedProofOutcome;
}

const noVar = breach('lint/no-var', 'src/a.mjs:3: use let or const', null, { code: 'no-var' });
const noLet = breach('lint/no-let', 'src/a.mjs:4: use const', null, { code: 'no-let' });
const refused = refuse({ code: 'unavailable', message: 'No input', location: null });

test('a proof line says why it was judged as it was', () => {
  assert.equal(
    formatProof(completed('red', { kind: 'proved', target: 'lint/no-var' }, fail(noLet, noVar))),
    '✓ lint / a var is flagged expected=red actual=fail\n    breached lint/no-var: src/a.mjs:3: use let or const',
  );
  assert.equal(
    formatProof(completed('red', { kind: 'target-rule-not-breached', target: 'lint/no-var', breached: ['lint/no-let'] }, fail(noLet))),
    '✗ lint / a var is flagged expected=red actual=fail\n    target lint/no-var not breached; breached lint/no-let',
  );
  assert.equal(
    formatProof(completed('red', { kind: 'verdict-mismatch', expected: 'fail', actual: 'pass' }, pass())),
    '✗ lint / a var is flagged expected=red actual=pass\n    expected fail, got pass; the mutation did not reach what the Rule guards',
  );
  assert.equal(
    formatProof(completed('red', { kind: 'target-already-breached', target: 'lint/no-var', breached: ['lint/no-var'] }, fail(noVar))),
    '✗ lint / a var is flagged expected=red actual=fail\n    target lint/no-var was already breached before the mutation; breached lint/no-var',
  );
  assert.equal(
    formatProof(completed('refuse', { kind: 'proved' }, refused)),
    '✓ lint / a var is flagged expected=refuse actual=refuse\n    refused unavailable: No input',
  );
  assert.equal(
    formatProof(completed('green', { kind: 'verdict-mismatch', expected: 'pass', actual: 'refuse' }, refused)),
    '✗ lint / a var is flagged expected=green actual=refuse\n    expected pass, got refuse: unavailable: No input',
  );
  assert.equal(
    formatProof(completed('green', { kind: 'proved' }, pass())),
    '✓ lint / a var is flagged expected=green actual=pass',
  );
});

test('a proof that hit an infrastructure error is never a tick and names the error', () => {
  const aborted: ProofOutcome = {
    status: 'aborted',
    gate: 'lint',
    proof: 'a var is flagged',
    expected: 'green',
    error: { code: 'mutation-apply-failed', message: 'Mutation could not be applied.', detail: 'src/a.mjs is missing' },
    workerPid: 1,
  };
  assert.equal(
    formatProof(aborted),
    '✗ lint / a var is flagged expected=green error=mutation-apply-failed\n  Mutation could not be applied.\n  src/a.mjs is missing',
  );

  const unrestored: ProofOutcome = {
    status: 'unrestored',
    gate: 'lint',
    proof: 'a var is flagged',
    expected: 'red',
    error: { code: 'workspace-not-restored', message: 'The workspace changed.' },
    result: fail(noVar),
    workerPid: 1,
  };
  assert.equal(
    formatProof(unrestored),
    '✗ lint / a var is flagged expected=red actual=fail error=workspace-not-restored\n  The workspace changed.',
  );
});

const described: GateDescription = {
  gate: 'quiet',
  rules: [{ label: 'R1', id: 'lint/no-var', description: 'no var declarations' }],
  check: 'run eslint\nover src',
  policies: { emptyEvidence: 'allow' },
  proofs: [
    { kind: 'red', name: 'flags a var', targetLabel: 'R1', mutation: 'append a var to src/a.mjs' },
    { kind: 'green', name: 'accepts clean sources' },
    { kind: 'refuse', name: 'refuses without a config', mutation: 'remove .eslintrc' },
  ],
};

test('describe lists Rules, the Check, the empty-evidence allowance, and what each proof expects', () => {
  assert.equal(formatGateDescription(described), [
    'Gate: quiet',
    '',
    'Rules:',
    '  R1 no var declarations',
    '',
    'Check:',
    '  run eslint',
    '  over src',
    '',
    'Empty evidence: allowed',
    '',
    'Proof R1:',
    '  flags a var',
    '  mutation: append a var to src/a.mjs',
    '  run the same Check',
    '  expect Gate FAIL',
    '',
    'Proof GREEN:',
    '  accepts clean sources',
    '  run the same Check',
    '  expect Gate PASS',
    '',
    'Proof REFUSE:',
    '  refuses without a config',
    '  mutation: remove .eslintrc',
    '  run the same Check',
    '  expect Gate REFUSE',
  ].join('\n'));
});

test('describe stays silent about empty evidence when the Gate refuses it', () => {
  const strict: GateDescription = { ...described, gate: 'strict', policies: { emptyEvidence: 'refuse' }, proofs: [] };
  const output = formatGateDescription(strict);

  assert.doesNotMatch(output, /Empty evidence/);
  assert.match(output, /Check:\n  run eslint\n  over src$/);
});

test('describe shows (none) for a Gate without Rules and RED for a proof without a target label', () => {
  const bare: GateDescription = {
    gate: 'bare',
    rules: [],
    check: 'nothing',
    policies: { emptyEvidence: 'refuse' },
    proofs: [{ kind: 'red', name: 'breaks something' }],
  };

  assert.match(formatGateDescription(bare), /^Gate: bare\n\nRules:\n  \(none\)\n\nCheck:\n  nothing\n\nProof RED:\n  breaks something\n  run the same Check\n  expect Gate FAIL$/);
});
