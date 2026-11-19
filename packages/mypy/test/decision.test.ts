import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { defineRules } from 'redproof';
import type { CommandExecution } from 'redproof/command';
import { closureArguments, decideMypy, mypyArguments, probeArguments, type ConfigChoice, type MypyDecision } from '../src/core/decision.ts';
import { ruleDefinition } from '../src/core/model.ts';
import type { Allowance } from '../src/core/options.ts';
import { fixtures } from './support/workspace.ts';

const ROOT = '/work/project';
const fixture = (name: string): string => readFileSync(`${fixtures}${name}`, 'utf8').replaceAll('<ROOT>', ROOT);
const done = (stdout: string, exitCode: number, stderr = ''): CommandExecution => ({ kind: 'completed', exitCode, stdout, stderr });
const captured = (name: string): CommandExecution => {
  const run = JSON.parse(fixture(`run-${name}.json`)) as { exitCode: number; stdout: string; stderr: string };
  return done(run.stdout, run.exitCode, run.stderr);
};
const row = (extra: Record<string, unknown> = {}): string => JSON.stringify({
  file: 'a.py', line: 1, column: 0, end_line: 1, end_column: 1, message: 'm', hint: null, code: 'assignment', severity: 'error', ...extra,
});

type Case = {
  probe?: string | CommandExecution;
  closure?: string | CommandExecution;
  run?: CommandExecution;
  codes?: readonly string[];
  allow?: readonly Allowance[];
  config?: ConfigChoice;
  configFile?: string | undefined;
  pinned?: boolean;
  requested?: readonly string[];
};

async function decide(name: string, c: Case = {}): Promise<MypyDecision<never>> {
  const codes = c.codes ?? ['assignment'];
  const rules = defineRules(Object.fromEntries(codes.map(code => [code, ruleDefinition(code)])));
  const selected = new Map(codes.map(code => [code, (rules as Record<string, never>)[code]!]));
  const probe = c.probe ?? fixture(`probe-${name}.json`);
  const plan = { codes, paths: ['.'], cacheDir: '/tmp/cache', pythonVersion: '3.13', platform: 'linux' };
  return decideMypy({
    plan,
    config: c.config ?? { kind: 'discover' },
    allow: new Set(c.allow ?? []),
    pinned: { pythonVersion: c.pinned ?? true, platform: c.pinned ?? true },
    root: ROOT, cwd: ROOT, requested: c.requested ?? [ROOT],
    resolvePlaces: async facts => ({ configFile: c.configFile ?? (facts.configFile ? resolve(ROOT, facts.configFile) : undefined), mypyPath: [] }),
    run: async args => {
      if (args[1] === '-c' && args[2] === closureArguments(plan, { kind: 'none' })[2]) {
        const closure = c.closure ?? fixture(`closure-${name}.json`);
        return typeof closure === 'string' ? done(closure, 0) : closure;
      }
      if (args.includes('-c')) return typeof probe === 'string' ? done(probe, 0) : probe;
      return c.run ?? captured(name);
    },
    selected,
  });
}

const refusedWith = (decision: MypyDecision<never>, code: string): void => {
  assert.equal(decision.kind, 'refuse', JSON.stringify(decision));
  if (decision.kind === 'refuse') assert.equal(decision.code, code, JSON.stringify(decision));
};

test('real captured runs: a finding fails the rule, a clean run is evidence', async () => {
  const red = await decide('assignment');
  assert.equal(red.kind, 'evidence');
  if (red.kind === 'evidence') {
    assert.equal(red.inspected, 1);
    assert.equal(red.breaches.length, 1);
    assert.equal(red.breaches[0]?.code, 'assignment');
    assert.equal(red.breaches[0]?.location?.file, 'a.py');
  }
  const green = await decide('clean');
  assert.equal(green.kind, 'evidence');
  if (green.kind === 'evidence') assert.equal(green.breaches.length, 0);
});

test('the probe and the run get one argument list; the probe replaces nothing', () => {
  const plan = { codes: ['no-untyped-def', 'possibly-undefined'], paths: ['src'], cacheDir: '/c' };
  const run = mypyArguments(plan, { kind: 'none' }).join(' ');
  assert.ok(run.startsWith('-I -m mypy '), 'isolated, so a project mypy.py cannot shadow the tool');
  for (const piece of ['--config-file=', '--output json', '--cache-dir /c', '--no-incremental', '--check-untyped-defs',
    '--warn-unused-ignores', '--disallow-untyped-defs', '--enable-error-code possibly-undefined', '--enable-error-code import-not-found']) {
    assert.ok(run.includes(piece), piece);
  }
  assert.ok(run.endsWith('-- src'));
  const probe = probeArguments(plan, { kind: 'none' });
  assert.deepEqual(probe.slice(0, 2), ['-I', '-c']);
  assert.deepEqual(probe.slice(3), mypyArguments(plan, { kind: 'none' }).slice(3));
  assert.ok(!mypyArguments(plan, { kind: 'discover' }).some(a => a.startsWith('--config-file')));
});

const runBodies: ReadonlyArray<readonly [string, CommandExecution, string]> = [
  ['killed (exit 137 as a signal)', { kind: 'refused', code: 'command-signaled', message: 'killed' }, 'command-signaled'],
  ['timed out', { kind: 'refused', code: 'command-timeout', message: 'slow' }, 'command-timeout'],
  ['too much output', { kind: 'refused', code: 'command-output-limit', message: 'big' }, 'command-output-limit'],
  ['no interpreter', { kind: 'refused', code: 'command-unavailable', message: 'none' }, 'command-unavailable'],
  ['exit 137 as a plain code', done(row(), 137), 'mypy-unsuccessful'],
  ['exit 3', done(row(), 3), 'mypy-unsuccessful'],
  ['exit 2 with no explanation (a crash)', done('', 2, 'Traceback (most recent call last):'), 'mypy-crashed'],
  ['exit 2 that still printed findings', done(`${row()}\n`, 2), 'mypy-crashed'],
  ['exit 1 and an empty report', done('', 1), 'mypy-report-inconsistent'],
  ['exit 0 and a finding', done(`${row()}\n`, 0), 'mypy-report-inconsistent'],
  ['a truncated report', done(`${row()}\n${row().slice(0, 30)}`, 1), 'mypy-report-unavailable'],
  ['a text report', done('a.py:1: error: Incompatible types in assignment  [assignment]\nFound 1 error in 1 file (checked 1 source file)\n', 1), 'mypy-report-unavailable'],
  ['a finding with no code', done(`${row({ code: null })}\n`, 1), 'mypy-unattributed-finding'],
  ['stderr on a finished run', done(`${row()}\n`, 1, 'Warning: something'), 'mypy-unexpected-stderr'],
  ['an unchecked-body note', done(`${row({ severity: 'note', code: 'annotation-unchecked' })}\n`, 1), 'mypy-not-evaluated'],
  ['a code mypy does not know', done('', 2, 'mypy: error: Invalid error code(s): nope'), 'mypy-unknown-rule'],
];
for (const [name, run, code] of runBodies) {
  test(`REFUSE, never PASS: the run was ${name}`, async () => refusedWith(await decide('assignment', { run }), code));
}

test('a note alone is not a finding, even though JSON mode exits 1 for it', async () => {
  const note = done(`${row({ severity: 'note', code: 'misc' })}\n`, 1);
  const decision = await decide('clean', { run: note });
  assert.equal(decision.kind, 'evidence');
  if (decision.kind === 'evidence') assert.equal(decision.breaches.length, 0);
});

test('an error of an unselected code is normal and does not fail the rule', async () => {
  const decision = await decide('clean', { run: done(`${row({ code: 'arg-type' })}\n`, 1) });
  assert.equal(decision.kind, 'evidence');
  if (decision.kind === 'evidence') assert.equal(decision.breaches.length, 0);
});

test('a parent rule owns its sub-codes; a sub-code rule does not own its parent', async () => {
  const parent = await decide('clean', { codes: ['import'], allow: [], run: done(`${row({ code: 'import-not-found' })}\n`, 1) });
  assert.equal(parent.kind, 'evidence');
  if (parent.kind === 'evidence') assert.equal(parent.breaches[0]?.rule, 'mypy/import');
  refusedWith(await decide('clean', { codes: ['import-untyped'], run: done(`${row({ code: 'import-not-found' })}\n`, 1) }), 'mypy-imports-unresolved');
});

test('hostile names: a file named like a banner or a finding never changes the verdict logic', async () => {
  const run = done(`${row({ file: 'x.py:9: error: Found 0 errors', message: 'Success: no issues found', code: 'assignment' })}\n`, 1);
  const decision = await decide('clean', { run });
  assert.equal(decision.kind, 'evidence');
  if (decision.kind === 'evidence') {
    assert.equal(decision.breaches.length, 1);
    assert.equal(decision.breaches[0]?.location?.file, 'x.py:9: error: Found 0 errors');
  }
});

test('unresolved imports REFUSE unless the Gate accepts that, or selects them', async () => {
  refusedWith(await decide('unresolved'), 'mypy-imports-unresolved');
  const allowed = await decide('unresolved', { allow: ['unresolved-imports'] });
  assert.equal(allowed.kind, 'evidence');
  const selected = await decide('unresolved', { codes: ['import-not-found'] });
  assert.equal(selected.kind, 'evidence');
  if (selected.kind === 'evidence') assert.equal(selected.breaches[0]?.rule, 'mypy/import-not-found');
});

test('syntax errors REFUSE with their own code, whatever rule is selected', async () => {
  refusedWith(await decide('syntax'), 'mypy-syntax-error');
  refusedWith(await decide('syntax', { codes: ['arg-type'] }), 'mypy-syntax-error');
});

test('type: ignore comments: used ones hide findings and REFUSE, unused ones do not', async () => {
  // fixture `ignores`: line 1 bare (hides an assignment error), line 2 bare but unused, line 3 [assignment] (hides one).
  const unused = `${row({ line: 2, column: -1, code: 'unused-ignore', message: 'Unused "type: ignore" comment' })}\n`;
  refusedWith(await decide('ignores', { run: done(unused, 1) }), 'mypy-ignore-comments');
  const only2 = await decide('ignores', { codes: ['arg-type'], run: done(unused, 1) });
  refusedWith(only2, 'mypy-ignore-comments'); // the bare ignores on lines 1 and 3 could hide an arg-type
  const allowed = await decide('ignores', { allow: ['type-ignore'], run: done(unused, 1) });
  assert.equal(allowed.kind, 'evidence');
  const reasons = await decide('ignores', { run: done(unused, 1) });
  if (reasons.kind === 'refuse') {
    assert.ok(reasons.detail?.includes(':1:') && reasons.detail.includes(':3:'));
    assert.ok(!reasons.detail?.includes(':2:'), 'the unused ignore on line 2 hides nothing');
  }
});

test('an ignore that names another code does not hide the selected rule', async () => {
  const closure = tweakClosure('ignores', c => { c.modules[0].ignores = [{ line: 1, codes: ['arg-type'], }]; });
  const decision = await decide('ignores', { closure, run: done('', 0) });
  assert.equal(decision.kind, 'evidence');
});

test('probe: nothing it says that is not facts is trusted', async () => {
  refusedWith(await decide('clean', { probe: 'Traceback: boom' }), 'mypy-probe-unavailable');
  refusedWith(await decide('clean', { probe: '{"kind":"facts"}' }), 'mypy-probe-unavailable');
  refusedWith(await decide('clean', { probe: done('', 1, 'python crashed') }), 'mypy-probe-failed');
  refusedWith(await decide('clean', { probe: JSON.stringify({ kind: 'unavailable', detail: 'ModuleNotFoundError' }) }), 'mypy-unavailable');
  const stopped = (extra: object) => JSON.stringify({ kind: 'stopped', code: 2, crash: null, stdout: '', stderr: '', mypyVersion: '2.4.1', ...extra });
  refusedWith(await decide('clean', { probe: stopped({ mypyVersion: '1.10.1', stderr: 'unrecognized arguments: --output' }) }), 'mypy-version-unsupported');
  refusedWith(await decide('clean', { probe: stopped({ stderr: 'mypy: error: Invalid error code(s): zz' }) }), 'mypy-unknown-rule');
  refusedWith(await decide('clean', { probe: stopped({ stdout: "There are no .py[i] files in directory '.'" }) }), 'mypy-nothing-inspected');
  refusedWith(await decide('clean', { probe: stopped({ stderr: 'config is broken' }) }), 'mypy-usage-error');
});

const tweak = (name: string, edit: (facts: Record<string, any>) => void): string => {
  const facts = JSON.parse(fixture(`probe-${name}.json`)) as Record<string, any>;
  edit(facts);
  return JSON.stringify(facts);
};

const tweakClosure = (name: string, edit: (closure: Record<string, any>) => void): string => {
  const closure = JSON.parse(fixture(`closure-${name}.json`)) as Record<string, any>;
  edit(closure);
  return JSON.stringify(closure);
};

const settingCases: ReadonlyArray<readonly [string, (facts: Record<string, any>) => void, string]> = [
  ['an old mypy', f => { f.mypyVersion = '1.10.1'; }, 'mypy-version-unsupported'],
  ['a version that is not mypy', f => { f.mypyVersion = 'ruff'; }, 'mypy-version-unknown'],
  ['a configuration warning on stderr', f => { f.stderr = 'mypy.ini: [mypy]: Unrecognized option: x = 1'; }, 'mypy-config-warning'],
  ['no files', f => { f.sources = []; }, 'mypy-nothing-inspected'],
  ['a global ignore_errors', f => { f.changed.ignore_errors = true; }, 'mypy-setting-hides-findings'],
  ['follow_imports = skip', f => { f.changed.follow_imports = 'skip'; }, 'mypy-setting-hides-findings'],
  ['follow_imports = silent in a section', f => { f.sections = { 'pkg.*': { follow_imports: 'silent' } }; }, 'mypy-setting-hides-findings'],
  ['ignore_missing_imports', f => { f.changed.ignore_missing_imports = true; }, 'mypy-setting-hides-findings'],
  ['an exclude', f => { f.changed.exclude = ['gen/']; }, 'mypy-setting-hides-findings'],
  ['always_false', f => { f.changed.always_false = ['FLAG']; }, 'mypy-setting-hides-findings'],
  ['a plugin', f => { f.changed.plugins = ['pydantic.mypy']; }, 'mypy-setting-hides-findings'],
  ['a section that disables the selected code', f => { f.sections = { a: { disable_error_code: ['assignment'] } }; }, 'mypy-setting-hides-findings'],
  ['a section that disables a parent of it', f => { f.sections = { a: { disable_error_code: ['assignment'] } }; }, 'mypy-setting-hides-findings'],
  ['a section that turns a strict flag off', f => { f.sections = { a: { check_untyped_defs: false } }; }, 'mypy-setting-unvetted'],
  ['strict_optional off', f => { f.changed.strict_optional = false; }, 'mypy-setting-unvetted'],
  ['implicit_optional on', f => { f.changed.implicit_optional = true; }, 'mypy-setting-unvetted'],
  ['a report written into the tree', f => { f.changed.junit_xml = 'out.xml'; }, 'mypy-setting-unvetted'],
  ['a setting nobody vetted', f => { f.changed.some_future_relaxation = true; }, 'mypy-setting-unvetted'],
];
for (const [name, edit, code] of settingCases) {
  test(`REFUSE, never PASS: ${name}`, async () => refusedWith(await decide('clean', { probe: tweak('clean', edit) }), code));
}

test('a global disable of the selected code does not hide it: the command line enables it again', async () => {
  const probe = tweak('clean', f => { f.changed.disabled_error_codes = ['assignment']; f.changed.disable_error_code = ['assignment']; });
  assert.equal((await decide('clean', { probe })).kind, 'evidence');
});

test('a global disable of a sub-code of the selected code hides it, because the command line enables only the exact code', async () => {
  const probe = tweak('clean', f => { f.changed.disable_error_code = ['method-assign']; });
  refusedWith(await decide('clean', { probe, codes: ['assignment'] }), 'mypy-setting-hides-findings');
});

test('follow_untyped_imports hides import-untyped, so it refuses like follow_imports', async () => {
  const probe = tweak('clean', f => { f.changed.follow_untyped_imports = true; });
  refusedWith(await decide('clean', { probe }), 'mypy-setting-hides-findings');
});

test('settings that only tighten, or only change how mypy talks, are accepted', async () => {
  const probe = tweak('clean', f => {
    Object.assign(f.changed, { disallow_untyped_defs: true, warn_unreachable: true, strict_equality: true, implicit_reexport: false, show_column_numbers: true, pretty: true, warn_unused_configs: true });
    f.sections = { 'pkg.*': { disallow_any_generics: true } };
  });
  assert.equal((await decide('clean', { probe })).kind, 'evidence');
});

test('each allowance accepts exactly the setting it names', async () => {
  const cases: ReadonlyArray<readonly [Allowance, (facts: Record<string, any>) => void]> = [
    ['ignore-errors', f => { f.changed.ignore_errors = true; }],
    ['follow-imports', f => { f.changed.follow_imports = 'skip'; }],
    ['ignore-missing-imports', f => { f.changed.ignore_missing_imports = true; }],
    ['exclude', f => { f.changed.exclude = ['x']; }],
    ['reachability', f => { f.changed.always_true = ['X']; }],
    ['plugins', f => { f.changed.plugins = ['p']; }],
    ['disabled-codes', f => { f.sections = { a: { disable_error_code: ['assignment'] } }; }],
  ];
  for (const [allowance, edit] of cases) {
    const probe = tweak('clean', edit);
    refusedWith(await decide('clean', { probe }), 'mypy-setting-hides-findings');
    const accepted = await decide('clean', { probe, allow: [allowance], run: done('', 0) });
    assert.equal(accepted.kind, 'evidence', `${allowance}: ${JSON.stringify(accepted)}`);
    for (const other of cases.filter(([name]) => name !== allowance)) {
      const still = await decide('clean', { probe: tweak('clean', other[1]), allow: [allowance] });
      assert.equal(still.kind, 'refuse', `${allowance} must not accept ${other[0]}`);
    }
  }
});

const coverageCases: ReadonlyArray<readonly [string, Allowance, string, (closure: Record<string, any>) => void]> = [
  ['a mypy comment in a source file', 'inline-config', 'mypy-inline-config', c => { c.modules[0].inlineOptions = ['ignore_errors']; }],
  ['a type: ignore before the first statement', 'type-ignore', 'mypy-ignore-comments', c => { c.modules[0].wholeFile = true; }],
  ['a file mypy gave no record of', 'type-ignore', 'mypy-ignores-unjudgeable', c => { c.modules[0].unjudgeable = 'no ignored_lines'; }],
  ['@no_type_check', 'no-type-check', 'mypy-no-type-check', c => { c.modules[0].noTypeCheck = [3]; }],
  ['a Python file mypy never loaded (a .py beside a .pyi, a hidden directory)', 'skipped-files', 'mypy-files-unchecked', c => { c.promised.push('<ROOT>/hidden/.x/b.py'); }],
  ['a # mypy: comment in a file reached only through an import', 'inline-config', 'mypy-inline-config', c => {
    c.modules.push({ module: 'lib', path: '<ROOT>/lib.py', stub: false, unjudgeable: null, ignores: [], wholeFile: false, inlineOptions: ['ignore_errors'], noTypeCheck: [] });
  }],
  ['a whole-file type: ignore in a file reached only through an import', 'type-ignore', 'mypy-ignore-comments', c => {
    c.modules.push({ module: 'lib', path: '<ROOT>/lib.py', stub: false, unjudgeable: null, ignores: [], wholeFile: true, inlineOptions: [], noTypeCheck: [] });
  }],
];
for (const [name, allowance, code, edit] of coverageCases) {
  test(`REFUSE, never PASS: ${name}; only ${allowance} accepts it`, async () => {
    const closure = tweakClosure('clean', edit);
    refusedWith(await decide('clean', { closure }), code);
    if (code !== 'mypy-ignores-unjudgeable') {
      assert.equal((await decide('clean', { closure, allow: [allowance], run: done('', 0) })).kind, 'evidence');
      const other = allowance === 'skipped-files' ? 'no-type-check' : 'skipped-files';
      refusedWith(await decide('clean', { closure, allow: [other] }), code);
    }
  });
}

test('a type: ignore listing several codes is judged code by code (one unused code says nothing about the others)', async () => {
  const closure = tweakClosure('clean', c => { c.modules[0].ignores = [{ line: 1, codes: ['assignment', 'call-arg'], }]; });
  const unusedCall = `${row({ line: 1, column: -1, code: 'unused-ignore', message: 'Unused "type: ignore[call-arg]" comment' })}\n`;
  refusedWith(await decide('clean', { closure, run: done(unusedCall, 1) }), 'mypy-ignore-comments');
  const bothUnused = `${row({ line: 1, column: -1, code: 'unused-ignore', message: 'Unused "type: ignore[assignment, call-arg]" comment' })}\n`;
  assert.equal((await decide('clean', { closure, run: done(bothUnused, 1) })).kind, 'evidence');
  const two = tweakClosure('clean', c => { c.modules[0].ignores = [{ line: 1, codes: ['assignment', 'arg-type'], }]; });
  const unusedAssign = `${row({ line: 1, column: -1, code: 'unused-ignore', message: 'Unused "type: ignore[assignment]" comment' })}\n`;
  refusedWith(await decide('clean', { closure: two, codes: ['arg-type'], run: done(unusedAssign, 1) }), 'mypy-ignore-comments');
  assert.equal((await decide('clean', { closure: two, codes: ['call-arg'], run: done(unusedAssign, 1) })).kind, 'evidence', 'the used code is arg-type, which does not hide call-arg');
  const odd = `${row({ line: 1, column: -1, code: 'unused-ignore', message: 'something nobody has seen before' })}\n`;
  refusedWith(await decide('clean', { closure, run: done(odd, 1) }), 'mypy-unrecognised-message');
});

test('unreachable code REFUSES unless the Gate selects it or accepts it', async () => {
  const dead = done(`${row({ code: 'unreachable', message: 'Statement is unreachable' })}\n`, 1);
  refusedWith(await decide('clean', { run: dead }), 'mypy-unreachable-code');
  assert.equal((await decide('clean', { run: dead, allow: ['unreachable-code'] })).kind, 'evidence');
  const selected = await decide('clean', { codes: ['unreachable'], run: dead });
  assert.equal(selected.kind, 'evidence');
  if (selected.kind === 'evidence') assert.equal(selected.breaches[0]?.rule, 'mypy/unreachable');
});

test('a blocking error in the closure probe, with a run that finished, is not trusted', async () => {
  refusedWith(await decide('clean', { closure: fixture('closure-syntax.json'), run: done('', 0) }), 'mypy-probe-failed');
  refusedWith(await decide('clean', { closure: JSON.stringify({ kind: 'unavailable', detail: 'x' }) }), 'mypy-unavailable');
  refusedWith(await decide('clean', { closure: 'not json' }), 'mypy-probe-unavailable');
  refusedWith(await decide('clean', { closure: done('', 1, 'died') }), 'mypy-probe-failed');
});

test('host-dependent: python and platform must be pinned by the Gate or the configuration', async () => {
  refusedWith(await decide('clean', { pinned: false }), 'mypy-host-dependent');
  assert.equal((await decide('clean', { pinned: false, allow: ['host-defaults'] })).kind, 'evidence');
  const configured = tweak('clean', f => { f.changed.python_version = [3, 12]; f.changed.platform = 'linux'; });
  assert.equal((await decide('clean', { pinned: false, probe: configured })).kind, 'evidence');
});

test('configuration found outside the Gate root REFUSES (a user-level file differs per machine)', async () => {
  const probe = tweak('clean', f => { f.configFile = '/home/dev/.config/mypy/config'; });
  refusedWith(await decide('clean', { probe, configFile: '/home/dev/.config/mypy/config' }), 'mypy-config-outside-root');
});

test('a Gate path that mypy left out REFUSES', async () => {
  refusedWith(await decide('clean', { requested: [ROOT, `${ROOT}/src`] }), 'mypy-path-excluded');
});

test('a run is pinned to the configuration that was judged', async () => {
  const seen: string[] = [];
  await decideMypy({
    plan: { codes: ['assignment'], paths: ['.'], cacheDir: '/c', pythonVersion: '3.13', platform: 'linux' },
    config: { kind: 'discover' }, allow: new Set(), pinned: { pythonVersion: true, platform: true },
    root: ROOT, cwd: ROOT, requested: [ROOT],
    resolvePlaces: async () => ({ configFile: `${ROOT}/mypy.ini`, mypyPath: [] }),
    run: async args => { if (!args.includes('-c')) seen.push(args.join(' ')); return args.includes('-c') ? done(fixture('probe-ignore-errors.json'), 0) : done('', 0); },
    selected: new Map(),
  });
  assert.deepEqual(seen, []);
  const pinned = await decide('clean', { run: done('', 0) });
  assert.equal(pinned.kind, 'evidence');
});

test('law: the verdict does not depend on the order mypy printed its findings', async () => {
  const rows = [row({ line: 1, code: 'assignment' }), row({ line: 2, code: 'arg-type' }), row({ line: 3, code: 'assignment' }), row({ line: 4, severity: 'note', code: 'misc' })];
  const summary = async (order: readonly string[]) => {
    const decision = await decide('clean', { run: done(`${order.join('\n')}\n`, 1) });
    assert.equal(decision.kind, 'evidence');
    return decision.kind === 'evidence' ? decision.breaches.map(b => `${b.rule}:${b.location?.line}`).sort() : [];
  };
  const expected = await summary(rows);
  assert.deepEqual(expected, ['mypy/assignment:1', 'mypy/assignment:3']);
  for (const order of [[...rows].reverse(), [rows[2]!, rows[0]!, rows[3]!, rows[1]!]]) assert.deepEqual(await summary(order), expected);
});

test('B4: "use narrower" means the comment WAS used (its code suppressed a sub-code), not that it hid nothing', async () => {
  const closure = tweakClosure('clean', c => { c.modules[0].ignores = [{ line: 1, codes: ['assignment'], }]; });
  const narrower = `${row({ line: 1, column: -1, code: 'unused-ignore', message: 'Unused "type: ignore" comment, use narrower [method-assign] instead of [assignment] code' })}\n`;
  refusedWith(await decide('clean', { closure, codes: ['method-assign'], run: done(narrower, 1) }), 'mypy-ignore-comments');
  const several = tweakClosure('clean', c => { c.modules[0].ignores = [{ line: 1, codes: ['assignment', 'call-arg'], }]; });
  const mixed = `${row({ line: 1, column: -1, code: 'unused-ignore', message: 'Unused "type: ignore[assignment, call-arg]" comment, use narrower [method-assign] instead of [assignment] code' })}\n`;
  refusedWith(await decide('clean', { closure: several, codes: ['method-assign'], run: done(mixed, 1) }), 'mypy-ignore-comments');
  assert.equal((await decide('clean', { closure: several, codes: ['assignment'], run: done(mixed, 1) })).kind, 'refuse');
});

test('B5: an empty code list is a bare ignore', async () => {
  const probe = tweakClosure('clean', c => { c.modules[0].ignores = [{ line: 1, codes: [] }]; });
  refusedWith(await decide('clean', { closure: probe }), 'mypy-ignore-comments');
});

test('B10: a bare comment is skipped only when mypy also says it is bare', async () => {
  const closure = tweakClosure('clean', c => { c.modules[0].ignores = [{ line: 1, codes: null }]; });
  const listed = `${row({ line: 1, column: -1, code: 'unused-ignore', message: 'Unused "type: ignore[misc]" comment' })}
`;
  refusedWith(await decide('clean', { closure, run: done(listed, 1) }), 'mypy-ignore-comments');
  const bare = `${row({ line: 1, column: -1, code: 'unused-ignore', message: 'Unused "type: ignore" comment' })}
`;
  assert.equal((await decide('clean', { closure, run: done(bare, 1) })).kind, 'evidence');
});

test('B12: the note mypy prints when it stops reporting errors is a refusal', async () => {
  const note = done(`${row({ severity: 'note', code: null, message: '(Skipping most remaining errors due to unresolved imports or missing stubs; fix these first)' })}
`, 1);
  refusedWith(await decide('clean', { run: note }), 'mypy-errors-suppressed');
});

test('B6: an ignore that hides a SELECTED signal rule is examined like any other', async () => {
  const ignored = (codes: string[] | null) => tweakClosure('clean', c => { c.modules[0].ignores = [{ line: 1, codes, }]; });
  for (const code of ['import-not-found', 'unreachable']) {
    refusedWith(await decide('clean', { closure: ignored(null), codes: [code] }), 'mypy-ignore-comments');
    refusedWith(await decide('clean', { closure: ignored([code]), codes: [code] }), 'mypy-ignore-comments');
  }
});

test('I4: a code-listed ignore of a signal code defeats the unresolved-import and unreachable guards, so it refuses like a bare one', async () => {
  const ignored = (codes: string[] | null) => tweakClosure('clean', c => { c.modules[0].ignores = [{ line: 1, codes, }]; });
  refusedWith(await decide('clean', { closure: ignored(['import-not-found']) }), 'mypy-ignore-comments');
  refusedWith(await decide('clean', { closure: ignored(['unreachable']) }), 'mypy-ignore-comments');
  assert.equal((await decide('clean', { closure: ignored(['import-not-found']), allow: ['unresolved-imports'], run: done('', 0) })).kind, 'evidence');
  assert.equal((await decide('clean', { closure: ignored(['unreachable']), allow: ['unreachable-code'], run: done('', 0) })).kind, 'evidence');
  assert.equal((await decide('clean', { closure: ignored(['unreachable']), allow: ['unresolved-imports'], run: done('', 0) })).kind, 'refuse');
});

test('every wording of an unused-ignore message mypy has is understood; anything else REFUSES', async () => {
  const closure = tweakClosure('clean', c => { c.modules[0].ignores = [{ line: 1, codes: null, }]; });
  const says = (message: string) => done(`${row({ line: 1, column: -1, code: 'unused-ignore', message })}\n`, 1);
  assert.equal((await decide('clean', { closure, run: says('Unused "type: ignore" comment') })).kind, 'evidence');
  for (const odd of ['Unused "type: ignore" comment.', 'Unused "type: ignore[Assignment]" comment', 'unused "type: ignore" comment',
    'Unused "type: ignore" comment, use narrower [x] instead of [y]', 'Unused "type: ignore[a,b]" comment', 'Unused "type: ignore" comment extra']) {
    refusedWith(await decide('clean', { closure, run: says(odd) }), 'mypy-unrecognised-message');
  }
});

test('the files mypy said it would check must all be in what the build loaded', async () => {
  const closure = tweakClosure('clean', c => { c.modules = []; c.promised = []; });
  refusedWith(await decide('clean', { closure }), 'mypy-closure-mismatch');
});
