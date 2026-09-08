import { spawn, type ChildProcess } from 'node:child_process';

const FORCE_KILL_AFTER_MS = 250;
const POLL_MS = 10;

function pause(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) {
    child.kill(signal);
    return;
  }

  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') child.kill(signal);
  }
}

function groupIsAlive(child: ChildProcess): boolean {
  if (child.pid === undefined) return false;
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForGroupExit(child: ChildProcess, durationMs: number): Promise<boolean> {
  const deadline = Date.now() + durationMs;
  while (groupIsAlive(child) && Date.now() < deadline) await pause(POLL_MS);
  return !groupIsAlive(child);
}

async function terminatePosixTree(child: ChildProcess): Promise<void> {
  signalGroup(child, 'SIGTERM');
  if (await waitForGroupExit(child, FORCE_KILL_AFTER_MS)) return;
  signalGroup(child, 'SIGKILL');
  await waitForGroupExit(child, FORCE_KILL_AFTER_MS);
}

async function terminateWindowsTree(child: ChildProcess): Promise<void> {
  if (child.pid === undefined) {
    child.kill('SIGKILL');
    return;
  }

  await new Promise<void>(resolve => {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    killer.once('error', () => {
      child.kill('SIGKILL');
      resolve();
    });
    killer.once('close', () => resolve());
  });
}

/** Stop the complete process tree before a refused execution can return. */
export async function terminateProcessTree(child: ChildProcess): Promise<void> {
  if (process.platform === 'win32') return terminateWindowsTree(child);
  return terminatePosixTree(child);
}
