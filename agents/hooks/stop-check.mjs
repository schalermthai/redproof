#!/usr/bin/env node
// Redproof Stop hook: runs the project's own `redproof check` when the agent ends a turn.
//
//   baseline  (SessionStart) remember where the session started; never prints.
//   stop      (Stop)         check the configs that own this session's changes.
//
// Output contract, shared by Claude Code and Codex:
//   exit 0, no output      nothing to report
//   exit 0, JSON on stdout a warning for the user; the turn ends
//   exit 2, text on stderr the turn stays open and the agent reads the text
// Plain text never goes to stdout, and exit 2 always carries a reason.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, resolve } from 'node:path';

// Keep in step with DEFAULT_CONFIG_FILES in packages/redproof/src/cli/core/arguments.ts.
const CONFIG_FILES = [
  'redproof.config.ts',
  'redproof.config.mts',
  'redproof.config.mjs',
  'redproof.config.cts',
  'redproof.config.cjs',
  'redproof.config.js',
];
const SETTINGS_FILE = 'redproof.stop-hook.json';
const MAX_BLOCKS = 3;
const CHECK_BUDGET_MS = Number(process.env.REDPROOF_STOP_HOOK_BUDGET_MS) || 240_000;
const BASELINE_BUDGET_MS = Math.min(CHECK_BUDGET_MS, 15_000);
const REPORT_CHARS = 6000;
const LARGE_FILE_BYTES = 8 * 1024 * 1024;
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const OFF_SWITCH = `Turn this hook off with REDPROOF_STOP_HOOK=off, or {"enabled": false} in ${SETTINGS_FILE} at the repository root.`;

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return result.status === 0 ? result.stdout : null;
}

function nulList(text) {
  return (text ?? '').split('\0').filter(Boolean);
}

function gitRoot(cwd) {
  const root = git(cwd, ['rev-parse', '--show-toplevel']);
  return root ? root.trim() : null;
}

function headCommit(root) {
  const head = git(root, ['rev-parse', '--verify', '--quiet', 'HEAD']);
  return head ? head.trim() : null;
}

/** Project settings. A malformed file is a problem to report, never an empty default. */
function readSettings(root) {
  const path = join(root, SETTINGS_FILE);
  if (!existsSync(path)) return { settings: { enabled: true, ignore: [] } };
  let value;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return { problem: `${SETTINGS_FILE} is not valid JSON: ${error.message}` };
  }
  const isObject = value !== null && typeof value === 'object' && !Array.isArray(value);
  const unknown = isObject ? Object.keys(value).filter(key => key !== 'enabled' && key !== 'ignore') : [];
  if (!isObject
    || unknown.length
    || (value.enabled !== undefined && typeof value.enabled !== 'boolean')
    || (value.ignore !== undefined && !(Array.isArray(value.ignore) && value.ignore.every(item => typeof item === 'string')))) {
    return { problem: `${SETTINGS_FILE} must be an object with only "enabled" (boolean) and "ignore" (list of folder patterns).` };
  }
  return { settings: { enabled: value.enabled !== false, ignore: value.ignore ?? [] } };
}

/** `fixtures/**` and `fixtures` both cover every folder under fixtures. */
function ignoreMatcher(patterns) {
  const tests = patterns.map(pattern => {
    const clean = pattern.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
    const source = clean
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*\/?|\*|\?/g, token => (token === '*' ? '[^/]*' : token === '?' ? '[^/]' : token === '**/' ? '(?:.*/)?' : '.*'));
    return new RegExp(`^${source}(?:/.*)?$`);
  });
  return dir => tests.some(test => test.test(dir));
}

/** Folders, relative to the repository root, whose config this hook may run. */
function configDirs(root, ignore) {
  const listed = git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ':(glob)**/redproof.config.*']);
  const ignored = ignoreMatcher(ignore);
  const dirs = new Set();
  for (const file of nulList(listed)) {
    if (!CONFIG_FILES.includes(posix.basename(file)) || !existsSync(join(root, file))) continue;
    const dir = posix.dirname(file);
    if (!ignored(dir)) dirs.add(dir);
  }
  return dirs;
}

/** The nearest config owns a file, as in ESLint and lint-staged. */
function ownerDir(file, dirs) {
  for (let dir = posix.dirname(file); ; dir = posix.dirname(dir)) {
    if (dirs.has(dir)) return dir;
    if (dir === '.') return null;
  }
}

function contentMark(path) {
  try {
    const stats = statSync(path);
    if (!stats.isFile()) return 'not-a-file';
    if (stats.size > LARGE_FILE_BYTES) return `large:${stats.size}:${stats.mtimeMs}`;
    return sha256(readFileSync(path));
  } catch {
    return 'absent';
  }
}

/**
 * Every file that differs from the session's starting commit (committed since, staged,
 * unstaged or untracked), with a mark of its current content. Comparing two snapshots
 * shows what changed between them, whether or not the agent committed in between.
 */
function snapshot(root, session) {
  const head = headCommit(root);
  if (session.startHead && git(root, ['cat-file', '-e', `${session.startHead}^{commit}`]) === null) session.startHead = head;
  const paths = session.startHead
    ? [...nulList(git(root, ['diff', '--name-only', '-z', session.startHead, '--'])), ...nulList(git(root, ['ls-files', '-z', '--others', '--exclude-standard']))]
    : nulList(git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']));
  const files = {};
  for (const path of [...new Set(paths)].sort()) files[path] = contentMark(join(root, path));
  return { files, digest: sha256(JSON.stringify(files)) };
}

function changedSince(verified, files) {
  return [...new Set([...Object.keys(verified), ...Object.keys(files)])].filter(path => verified[path] !== files[path]);
}

function openStore(key) {
  const data = process.env.CLAUDE_PLUGIN_DATA || process.env.PLUGIN_DATA || join(tmpdir(), 'redproof-plugin-data');
  const dir = join(data, 'stop-hook', sha256(key).slice(0, 16));
  const file = join(dir, 'state.json');
  let state = {};
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) state = parsed;
  } catch {
    // No state yet, or an unreadable one: start again. The cost is one extra check.
  }
  if (state.sessions === null || typeof state.sessions !== 'object') state.sessions = {};
  return {
    dir,
    state,
    save() {
      const now = Date.now();
      for (const [id, session] of Object.entries(state.sessions)) {
        if (!(now - session.updatedAt < SESSION_TTL_MS)) delete state.sessions[id];
      }
      mkdirSync(dir, { recursive: true });
      const temporary = `${file}.${process.pid}.tmp`;
      writeFileSync(temporary, JSON.stringify(state));
      renameSync(temporary, file);
    },
  };
}

function sessionOf(store, id) {
  const session = store.state.sessions[id] ?? (store.state.sessions[id] = { chain: 0 });
  session.updatedAt = Date.now();
  return session;
}

/** The CLI file of the nearest locally installed redproof. Never npx, never the network. */
function localCli(root, dir) {
  for (let current = resolve(root, dir); ; current = dirname(current)) {
    const manifest = join(current, 'node_modules', 'redproof', 'package.json');
    if (existsSync(manifest)) {
      let bin;
      try {
        const parsed = JSON.parse(readFileSync(manifest, 'utf8'));
        bin = typeof parsed.bin === 'string' ? parsed.bin : parsed.bin?.redproof;
      } catch {
        bin = undefined;
      }
      const script = bin ? resolve(dirname(manifest), bin) : null;
      if (script && existsSync(script)) return { script };
      return { problem: `the redproof package in ${dirname(manifest)} has no runnable CLI file (is it built?)` };
    }
    if (current === resolve(root) || current === dirname(current)) {
      return { missing: true, problem: 'no local Redproof library is installed (looked for node_modules/redproof up to the repository root)' };
    }
  }
}

function tail(text, limit) {
  const trimmed = text.trimEnd();
  if (trimmed.length <= limit) return trimmed;
  const cut = trimmed.slice(-limit);
  return `[... earlier output cut ...]\n${cut.slice(cut.indexOf('\n') + 1)}`;
}

/** verdict: 'pass' | 'fail' | 'cannot-run' | 'not-installed'. Only a report file proves the check itself ran. */
function runCheck(root, dir, reportFile, deadline) {
  const cli = localCli(root, dir);
  if (cli.problem) return Promise.resolve({ dir, verdict: cli.missing ? 'not-installed' : 'cannot-run', reason: cli.problem, output: '' });
  rmSync(reportFile, { force: true });
  return new Promise(done => {
    const chunks = [];
    const child = spawn(process.execPath, [cli.script, 'check', '--reporter=default', `--reporter=json:${reportFile}`], {
      cwd: resolve(root, dir),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      // The check starts workers and tools; stop the whole group, not only the CLI.
      try {
        if (process.platform === 'win32') child.kill('SIGKILL');
        else process.kill(-child.pid, 'SIGKILL');
      } catch {
        // Already gone.
      }
    }, Math.max(1, deadline - Date.now()));
    child.stdout.on('data', chunk => chunks.push(chunk));
    child.stderr.on('data', chunk => chunks.push(chunk));
    child.on('error', error => {
      clearTimeout(timer);
      done({ dir, verdict: 'cannot-run', reason: `redproof could not start: ${error.message}`, output: '' });
    });
    child.on('close', code => {
      clearTimeout(timer);
      const output = Buffer.concat(chunks).toString('utf8');
      if (timedOut) return done({ dir, verdict: 'cannot-run', reason: 'redproof check ran out of time and was stopped', output });
      let report = null;
      try {
        report = JSON.parse(readFileSync(reportFile, 'utf8'));
      } catch {
        // No report: the CLI stopped before it had a verdict.
      }
      if (report?.version !== 1 || report.command !== 'check'
        || !['passed', 'failed', 'refused'].includes(report.status)
        || !Array.isArray(report.gates)
        || report.gates.some(gate => !gate || !['pass', 'fail', 'refuse'].includes(gate.verdict)
          || typeof gate.file !== 'string' || !Array.isArray(gate.rules)
          || gate.rules.some(rule => !rule || !Array.isArray(rule.breaches)))) {
        return done({ dir, verdict: 'cannot-run', reason: `redproof exited with code ${code} without a check report`, output });
      }
      // The exit policy can map REFUSE to any code, including zero.
      if (report.status === 'refused' || report.gates.some(gate => gate.verdict === 'refuse')) {
        return done({ dir, verdict: 'cannot-run', reason: 'a Gate refused: the required evidence is unavailable or untrustworthy', output });
      }
      const hasFailure = report.gates.some(gate => gate.verdict === 'fail');
      if (code === null || (report.status === 'passed' && (code !== 0 || hasFailure))
        || (report.status === 'failed' && (code === 0 || !hasFailure))) {
        return done({ dir, verdict: 'cannot-run', reason: 'the check report contradicts the process result', output });
      }
      done({ dir, verdict: report.status === 'passed' ? 'pass' : 'fail', output, report });
    });
  });
}

function breachKey(gate, rule, breach) {
  return sha256(JSON.stringify({ gate: gate.id, rule: rule.id, breach }));
}

function failureBaseline(root, dir, report) {
  const entries = [];
  for (const gate of report.gates) {
    if (gate.verdict !== 'fail') continue;
    for (const rule of gate.rules) {
      for (const breach of rule.breaches) {
        const file = breach.location?.file;
        if (typeof file !== 'string' || !file) continue;
        entries.push({
          key: breachKey(gate, rule, breach),
          file,
          mark: contentMark(resolve(root, dir, file)),
          gateFile: gate.file,
          gateMark: contentMark(resolve(root, dir, gate.file)),
        });
      }
    }
  }
  return {
    entries,
    configMarks: Object.fromEntries(CONFIG_FILES.map(file => [file, contentMark(resolve(root, dir, file))])),
  };
}

/** Exempt only known, located Breaches whose source and Gate inputs did not change. */
function filterBaselineFailures(root, result, baseline) {
  if (!baseline || !baseline.entries?.length || !result.report) return result;
  if (CONFIG_FILES.some(file => baseline.configMarks?.[file] !== contentMark(resolve(root, result.dir, file)))) {
    baseline.entries = [];
    return result;
  }
  // Once touched, an old defect cannot regain its exemption by restoring old bytes.
  baseline.entries = baseline.entries.filter(entry => entry.mark === contentMark(resolve(root, result.dir, entry.file))
    && entry.gateMark === contentMark(resolve(root, result.dir, entry.gateFile)));
  let ignored = 0;
  const actionable = [];
  for (const gate of result.report.gates) {
    if (gate.verdict !== 'fail') continue;
    let gateCount = 0;
    for (const rule of gate.rules) {
      for (const breach of rule.breaches) {
        gateCount += 1;
        const original = baseline.entries.find(entry => entry.key === breachKey(gate, rule, breach));
        if (original && original.mark === contentMark(resolve(root, result.dir, original.file))
          && original.gateMark === contentMark(resolve(root, result.dir, original.gateFile))) {
          ignored += 1;
        } else {
          actionable.push(`FAIL ${gate.id} > ${rule.id}: ${breach.message} (${breach.code})${breach.location?.file ? ` at ${breach.location.file}` : ''}`);
        }
      }
    }
    // Non-countable failures with no located diagnostic remain actionable.
    if (gateCount === 0) actionable.push(`FAIL ${gate.id}: a failure without located Breach evidence remains actionable.`);
  }
  if (!ignored) return result;
  if (!actionable.length) return { ...result, verdict: 'pre-existing' };
  return { ...result, output: `${actionable.join('\n')}\n\n${ignored} unchanged, pre-existing Breach(es) do not block this turn. See the full log for the original report.` };
}

function block(text) {
  process.stderr.write(`${text.trimEnd()}\n`);
  process.exitCode = 2;
}

function warn(text) {
  process.stdout.write(`${JSON.stringify({ systemMessage: text })}\n`);
}

function label(dir) {
  return dir === '.' ? 'repository root' : dir;
}

function describe(results, root, logFile) {
  const share = Math.floor(REPORT_CHARS / results.length);
  const sections = results.map(result => {
    const heading = result.verdict === 'fail'
      ? `--- ${label(result.dir)}: redproof check failed ---`
      : `--- ${label(result.dir)}: ${result.reason} ---`;
    const rerun = `Rerun: cd ${resolve(root, result.dir)} && npx --no-install redproof check`;
    return [heading, tail(result.output, share), rerun].filter(Boolean).join('\n');
  });
  return `${sections.join('\n\n')}\n\nFull output: ${logFile}`;
}

/** A check that could not run blocks one time per session, then only warns. */
function cannotRun(store, session, detail) {
  const text = `Redproof check could not run, so the Gates are unverified. This is not a pass.\n\n${detail}\n\n`;
  const repeat = session.cannotRunBlocked === true;
  session.cannotRunBlocked = true;
  store.save();
  if (repeat) warn(`${text}${OFF_SWITCH}`);
  else block(`${text}Tell the user that the check did not run. Do not report the Gates as passing, and do not install or upgrade anything without the user's approval.\n${OFF_SWITCH}`);
}

/**
 * A project that has a config but no installed library is often mid-setup or freshly
 * cloned. Installing is the user's decision, so the agent is not sent back to work:
 * the user gets one warning per session. Repeating it every turn only teaches people
 * to ignore it.
 */
function notInstalled(store, session, dirs) {
  const repeat = session.notInstalledWarned === true;
  session.notInstalledWarned = true;
  store.save();
  if (repeat) return;
  warn(`Redproof check did not run for ${dirs.map(label).join(', ')}: no local Redproof library is installed (looked for node_modules/redproof up to the repository root). The Gates are unverified; this is not a pass. To enable the check, install the project's dependencies, or for a first-time setup add the library: npm install --save-dev redproof. ${OFF_SWITCH}`);
}

function nearestConfigDir(start) {
  for (let current = resolve(start); ; current = dirname(current)) {
    if (CONFIG_FILES.some(file => existsSync(join(current, file)))) return current;
    if (current === dirname(current)) return null;
  }
}

async function stop(input) {
  const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd();
  const sessionId = typeof input.session_id === 'string' && input.session_id ? input.session_id : 'unknown';
  const root = gitRoot(cwd);

  if (!root) {
    // Without git there is no way to tell what the turn changed. Say so one time.
    const dir = nearestConfigDir(cwd);
    if (!dir) return;
    const store = openStore(dir);
    const session = sessionOf(store, sessionId);
    const first = session.noGitWarned !== true;
    session.noGitWarned = true;
    store.save();
    if (first) warn(`Redproof Stop hook did not run: ${dir} is not inside a git repository, and the hook needs git to see what changed. Run the check yourself with: npx --no-install redproof check`);
    return;
  }

  const { settings, problem } = readSettings(root);
  if (settings && !settings.enabled) return;
  const dirs = configDirs(root, settings ? settings.ignore : []);
  if (dirs.size === 0) return;

  const store = openStore(root);
  const known = Object.hasOwn(store.state.sessions, sessionId);
  const session = sessionOf(store, sessionId);
  if (input.stop_hook_active !== true) session.chain = 0;
  if (problem) return cannotRun(store, session, problem);

  if (!known) Object.assign(session, { startHead: headCommit(root), verified: {} });
  const before = snapshot(root, session);
  const owners = [...new Set(changedSince(session.verified, before.files).map(file => ownerDir(file, dirs)).filter(Boolean))].sort();
  if (owners.length === 0) return store.save();
  const logFile = join(store.dir, 'last-report.log');
  if (before.digest === session.lastFail) {
    store.save();
    return warn(`Redproof: Gates are still failing and nothing has changed since the last report. Full output: ${logFile}`);
  }

  mkdirSync(store.dir, { recursive: true });
  const deadline = Date.now() + CHECK_BUDGET_MS;
  const results = [];
  for (const [index, dir] of owners.entries()) {
    results.push(await runCheck(root, dir, join(store.dir, `report-${index}.json`), deadline));
  }
  writeFileSync(logFile, results.map(result => `=== ${label(result.dir)}: ${result.verdict} ===\n${result.output}`).join('\n\n'));

  // The check may write files of its own; remember the tree as the next stop will see it.
  const after = snapshot(root, session);
  for (const result of results) {
    if (result.verdict === 'pass' && session.failureBaselines) delete session.failureBaselines[result.dir];
  }
  const scoped = results.map(result => result.verdict === 'fail'
    ? filterBaselineFailures(root, result, session.failureBaselines?.[result.dir]) : result);
  const preExisting = scoped.filter(result => result.verdict === 'pre-existing');
  const failed = scoped.filter(result => result.verdict === 'fail');
  const missing = results.filter(result => result.verdict === 'not-installed');
  const unrun = results.filter(result => result.verdict === 'cannot-run');

  if (failed.length === 0 && unrun.length === 0 && missing.length === 0) {
    Object.assign(session, { verified: after.files, chain: 0 });
    delete session.lastFail;
    store.save();
    if (preExisting.length) warn(`Redproof: only unchanged, pre-existing Breaches remain in ${preExisting.map(result => label(result.dir)).join(', ')}. They do not block this turn; the Gates are not passing. Full output: ${logFile}`);
    return;
  }
  if (failed.length === 0 && unrun.length === 0) return notInstalled(store, session, missing.map(result => result.dir));
  if (failed.length === 0) return cannotRun(store, session, describe([...unrun, ...missing], root, logFile));

  session.lastFail = after.digest;
  session.chain += 1;
  store.save();
  const report = describe([...failed, ...unrun, ...missing], root, logFile);
  if (session.chain > MAX_BLOCKS) {
    return warn(`Redproof: Gates are still failing after ${MAX_BLOCKS} attempts in this turn. The turn ended with failing Gates.\n\n${report}`);
  }
  block(`Redproof check failed (block ${session.chain} of ${MAX_BLOCKS}). Fix each breached Rule below, or tell the user why you cannot.\n\n${report}`);
}

async function baseline(input) {
  const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd();
  const sessionId = typeof input.session_id === 'string' && input.session_id ? input.session_id : 'unknown';
  const root = gitRoot(cwd);
  if (!root) return;
  const { settings } = readSettings(root);
  if (settings && !settings.enabled) return;
  const dirs = configDirs(root, settings ? settings.ignore : []);
  if (dirs.size === 0) return;
  const store = openStore(root);
  // A resumed or compacted session keeps its first baseline.
  if (Object.hasOwn(store.state.sessions, sessionId)) return;
  // Whatever is already uncommitted belongs to the user, not to this session.
  const session = Object.assign(sessionOf(store, sessionId), { startHead: headCommit(root) });
  session.verified = snapshot(root, session).files;
  session.failureBaselines = {};
  // Save before execution so a host interruption does not lose the file baseline.
  store.save();
  const deadline = Date.now() + BASELINE_BUDGET_MS;
  for (const [index, dir] of [...dirs].sort().entries()) {
    if (Date.now() >= deadline) break;
    const reportFile = join(store.dir, `baseline-${index}.json`);
    const result = await runCheck(root, dir, reportFile, deadline);
    if (result.verdict === 'fail') session.failureBaselines[dir] = failureBaseline(root, dir, result.report);
    rmSync(reportFile, { force: true });
  }
  store.save();
}

async function main() {
  const mode = process.argv[2];
  if (/^(off|0|false|no)$/i.test(process.env.REDPROOF_STOP_HOOK ?? '')) return;
  let input = {};
  try {
    const parsed = JSON.parse(readFileSync(0, 'utf8'));
    if (parsed !== null && typeof parsed === 'object') input = parsed;
  } catch {
    // No readable hook input: fall back to the working directory.
  }
  if (mode === 'baseline') {
    try {
      await baseline(input);
    } catch {
      // The baseline is an optimisation. A session start must stay silent.
    }
    return;
  }
  if (mode !== 'stop') {
    process.stderr.write('Usage: stop-check.mjs <baseline|stop>\n');
    process.exitCode = 1;
    return;
  }
  try {
    await stop(input);
  } catch (error) {
    process.exitCode = 0;
    warn(`Redproof Stop hook hit an internal error, so the check did not run: ${error?.stack ?? error}`);
  }
}

await main();
