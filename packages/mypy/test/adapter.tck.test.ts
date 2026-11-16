import { runAdapterTck, type AdapterTckSpec, type EvidenceObservation } from '@redproof/adapter-tck';
import { mypy } from '../src/index.ts';
import { hasMypy, python, readFixture, replayPython, withFiles } from './support/workspace.ts';

const rules = { assignments: 'assignment' } as const;
const adapter = mypy({ rules });

/**
 * Evidence goes through the whole check, so the TCK sees what a Gate sees, including REFUSE. A real captured probe
 * and mypy run are replayed by a stand-in interpreter, so the TCK needs no mypy.
 */
const checked = (name: string): Promise<EvidenceObservation> => withFiles({ 'a.py': 'x: int = 1\n' }, async root => {
  const run = JSON.parse((await readFixture(`run-${name}.json`)).replaceAll('<ROOT>', root)) as { exitCode: number; stdout: string; stderr: string };
  const probe = (await readFixture(`probe-${name}.json`)).replaceAll('<ROOT>', root);
  const command = await replayPython(root, probe, run.stdout, run.exitCode, run.stderr);
  const subject = mypy({ rules, python: command, pythonVersion: '3.13', platform: 'linux' });
  return { kind: 'checked', result: await subject.check.run({ root, rules: ['mypy/assignment'] }) };
});

/** A tree that breaks only an unselected rule: real mypy reports an arg-type error, which this Gate did not ask about. */
const unselected = (): Promise<EvidenceObservation> => withFiles({ 'a.py': 'def f(x: int) -> None: ...\nf("s")\n' }, async root => {
  if (!hasMypy) return checked('unselected');
  const subject = mypy({ rules, python, pythonVersion: '3.13', platform: 'linux', isolated: true });
  return { kind: 'checked', result: await subject.check.run({ root, rules: ['mypy/assignment'] }) };
});

runAdapterTck([{
  name: 'mypy', kind: 'mypy',
  construction: {
    valid: () => adapter,
    emptyRules: { name: 'rejects empty rules', run: () => mypy({ rules: {} }), message: /at least one/u },
    unknownOption: { name: 'rejects unknown option', run: () => mypy({ rules, mystery: true } as never), message: /Unknown/u },
    invalidValues: [
      { name: 'rejects an unknown code', run: () => mypy({ rules: { a: 'nope' } }), message: /Unknown mypy rule/u },
      { name: 'refuses to promise syntax errors as a rule', run: () => mypy({ rules: { a: 'syntax' } }), message: /cannot be selected/u },
      { name: 'rejects overlapping codes', run: () => mypy({ rules: { a: 'import', b: 'import-not-found' } }), message: /must not overlap/u },
      { name: 'rejects an absolute path', run: () => mypy({ rules, paths: ['/etc'] }), message: /relative path/u },
      { name: 'rejects an option masquerading as a path', run: () => mypy({ rules, paths: ['--strict'] }), message: /relative path/u },
      { name: 'rejects isolated with configFile', run: () => mypy({ rules, isolated: true, configFile: 'mypy.ini' }), message: /cannot be combined/u },
      { name: 'rejects an unknown allowance', run: () => mypy({ rules, allow: ['all'] as never }), message: /Unknown mypy allowance/u },
      { name: 'rejects an empty python', run: () => mypy({ rules, python: ' ' }), message: /python must not be empty/u },
      { name: 'rejects an invalid timeout', run: () => mypy({ rules, timeoutMs: 0 }), message: /positive integer/u },
    ],
  },
  unavailable: [{
    name: 'a missing interpreter REFUSES',
    code: 'command-unavailable',
    run: () => withFiles({ 'a.py': 'x: int = 1\n' }, root =>
      mypy({ rules, python: 'redproof-tck-no-such-python' }).check.run({ root, rules: ['mypy/assignment'] })),
  }],
  evidence: [{
    rule: 'mypy/assignment',
    expectedBreaches: [{ code: 'assignment' }],
    violating: () => checked('assignment'),
    clean: () => checked('clean'),
    unselected,
  }],
  purity: {
    kind: 'sources',
    files: [
      'packages/mypy/src/core/decision.ts',
      'packages/mypy/src/core/facts.ts',
      'packages/mypy/src/core/model.ts',
      'packages/mypy/src/core/options.ts',
      'packages/mypy/src/core/probe.ts',
    ],
    allowedExternalImports: ['node:path', 'redproof', 'redproof/command'],
  },
  capabilities: { kind: 'not-applicable', reason: 'The JSON report carries every diagnostic of every selected rule; no selectable rule depends on report features.' },
} satisfies AdapterTckSpec]);
