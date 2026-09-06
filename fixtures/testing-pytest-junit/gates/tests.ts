import { report, runner, testing } from '@redproof/testing';
import { defineGate, defineProofs, locate, mutate, proof } from 'redproof';

const adapter = testing({
  runner: runner.command({
    command: 'pytest',
    description: 'run pytest',
    args: ({ reportFile }) => ['-q', '-p', 'no:cacheprovider', `--junitxml=${reportFile}`],
    env: { PYTHONDONTWRITEBYTECODE: '1' },
  }),
  report: report.junitXml(),
  rules: {
    testsPass: true,
    noSkippedTests: true,
  },
});

const gate = defineGate({ id: 'python-tests', adapter });

export const proofs = defineProofs(gate, [
  proof.red(
    adapter.rules.testsPass,
    'detects broken Python production behavior',
    mutate.replaceText(
      locate.text({ files: 'src/calculator.py', find: 'return left + right' }),
      'return left - right',
    ),
  ),
  proof.red(
    adapter.rules.noSkippedTests,
    'detects a skipped pytest test',
    mutate.insertBefore(
      locate.text({ files: 'test_calculator.py', find: 'def test_adds_numbers():' }),
      '@pytest.mark.skip(reason="redproof")\n',
    ),
  ),
  proof.green('accepts a healthy pytest suite'),
  proof.refuse(
    'refuses when pytest cannot collect a trustworthy suite',
    mutate.remove('test_calculator.py'),
  ),
]);

export default gate;
