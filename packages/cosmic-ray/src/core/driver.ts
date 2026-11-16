/**
 * The Python entry point the adapter runs instead of `python -m cosmic_ray.cli`.
 *
 * cosmic-ray records every non-zero test exit AND every signal death as `killed`, with whatever stdout was captured, and it drops
 * stderr. So "killed" is not evidence of detection: an OOM-killed or SIGKILLed pytest looks the same as a failed assertion, and a
 * stdlib `unittest` failure (written to stderr) looks like a silent run. This driver swaps cosmic-ray's `run_tests` for one that
 * runs the same command and reports what really happened as the FIRST line of the recorded output, written by this process (the
 * cosmic-ray worker), which the code under test cannot reach:
 *
 *   REDPROOF-EXIT 0          tests passed (the mutant survived)
 *   REDPROOF-EXIT <n>        the runner exited with its own failure code n > 0 (a real kill)
 *   REDPROOF-SIGNALLED <n>   the test process died from a signal (or exited 129-192, a shell reporting one): not a kill
 *   REDPROOF-UNSTARTED       the test command could not be started: not a kill
 *   timeout                  cosmic-ray's own timeout convention, kept as is; only when the runner itself was still running
 *
 * After every run the whole process group of the test command is killed, so a child the mutant left behind cannot outlive it.
 * A held pipe is never read as a timeout: a runner that exited keeps its exit code even when a child kept the pipe open.
 *
 * stderr is merged into stdout. During `baseline`, anything but a pass is reported as a failure, so a baseline that could not
 * run no longer passes. A distributor that does not run in this process leaves the first line off, and an unmarked kill is refused.
 */
export const COSMIC_RAY_DRIVER = `
import os, shlex, signal, subprocess, sys, traceback
import cosmic_ray.mutating as _mutating
from cosmic_ray.cli import main
from cosmic_ray.work_item import TestOutcome

_BASELINE = len(sys.argv) > 1 and sys.argv[1] == 'baseline'

def _kill_group(proc):
    # The command leads its own session, so its process group id is its pid (no getpgid: the leader may already be gone).
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except (AttributeError, OSError):
        pass

def _not_a_kill(marker, text):
    # A baseline that did not pass must fail the baseline; a mutant that was not judged must stay unjudged.
    return (TestOutcome.KILLED if _BASELINE else TestOutcome.INCOMPETENT, marker + '\\n' + text)

def _run_tests(command, timeout):
    env = dict(os.environ)
    env['PYTHONDONTWRITEBYTECODE'] = '1'
    try:
        proc = subprocess.Popen(shlex.split(command), env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
        timed_out = False
        try:
            out, _ = proc.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            # The pipe being open is not the runner being slow: a child that outlives the runner holds it too. Only a runner
            # that is still running is a timeout; one that already exited keeps its own exit code.
            timed_out = proc.poll() is None
            _kill_group(proc)
            out, _ = proc.communicate()
        _kill_group(proc)
        if timed_out:
            return (TestOutcome.KILLED, 'timeout')
        text = out.decode('utf-8', 'replace')
        code = proc.returncode
        if code == 0:
            return (TestOutcome.SURVIVED, 'REDPROOF-EXIT 0\\n' + text)
        if code < 0 or 128 < code <= 192:
            return _not_a_kill('REDPROOF-SIGNALLED %d' % code, text)
        return (TestOutcome.KILLED, 'REDPROOF-EXIT %d\\n' % code + text)
    except Exception:
        return _not_a_kill('REDPROOF-UNSTARTED', traceback.format_exc())

_mutating.run_tests = _run_tests
sys.exit(main(sys.argv[1:]))
`;
