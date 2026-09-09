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
  } catch {
    child.kill(signal);
  }
}

function groupIsAlive(child: ChildProcess): boolean {
  if (child.pid === undefined) return false;
  if (child.exitCode === null && child.signalCode === null) return true;
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
    killer.once('close', code => {
      if (code !== 0) child.kill('SIGKILL');
      resolve();
    });
  });
}

const FORWARDED_SIGNALS: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];
const liveChildren = new Set<ChildProcess>();
let forwarding = false;

function forwardSignal(signal: NodeJS.Signals): void {
  for (const child of liveChildren) signalGroup(child, signal);
  stopForwarding();
  if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
}

function killLiveGroups(): void {
  for (const child of liveChildren) signalGroup(child, 'SIGKILL');
}

function startForwarding(): void {
  if (forwarding) return;
  forwarding = true;
  for (const signal of FORWARDED_SIGNALS) process.on(signal, forwardSignal);
  process.on('exit', killLiveGroups);
}

function stopForwarding(): void {
  if (!forwarding) return;
  forwarding = false;
  for (const signal of FORWARDED_SIGNALS) process.removeListener(signal, forwardSignal);
  process.removeListener('exit', killLiveGroups);
}

/** Supervise a detached child's group until the caller finishes all process and pipe cleanup. */
export function superviseProcessTree(child: ChildProcess): () => void {
  if (process.platform === 'win32') return () => {};
  liveChildren.add(child);
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    liveChildren.delete(child);
    if (liveChildren.size === 0) stopForwarding();
  };
  startForwarding();
  return release;
}

/** Stop the complete process tree before a refused execution can return. */
export async function terminateProcessTree(child: ChildProcess): Promise<void> {
  if (process.platform === 'win32') return terminateWindowsTree(child);
  return terminatePosixTree(child);
}
