#!/usr/bin/env node
// Runner scaffold for the build-eval / hillclimb loop. Copy this into the
// user's repo and fill in loadCases / runCase / gradeCase below - the I/O
// shape, file naming, resume, and CLI surface are already hillclimb-ready
// so adding v2, v3, ... is `--variant v3`, not a refactor.
//
//   node run-eval.mjs --flow .claude/hillclimb/<name> --variant baseline --reps 2
//
// Structural properties this encodes (so you don't have to remember them):
//   - parameterized by --variant / --model / --reps (no hardcoded A/B pair)
//   - rep-aware filenames + resume (traces/<id>_rep<k>.json)
//   - reads _state.json, never writes it (loop state belongs to the orchestrator) - 
//     the ONE exception is --approve-harness recording `harness_sha` (see below)
//   - refuses to run when the harness (this file + _state.json.harness_paths) has
//     changed since the sha a human last approved with --approve-harness, so a
//     round that edits the runner cannot execute unreviewed under a standing
//     session allowlist
//   - pairwise graders judge against frozen baseline/ref/<id>.* on disk
//   - writes rows as cases complete (crash-safe)
//   - jittered exponential backoff on transient 429/overloaded/5xx errors
//   - hard per-case wall-clock ceiling (--timeout-s; stream keepalives don't reset it)
//   - served-model assertion (response model must match --model; documented alias->snapshot
//     shapes tolerated: 'foo-latest'/'foo-0'/'foo' -> 'foo-20250101' / 'foo@20250101' / 'foo-2025-01-01')
//   - failed attempts land in errors.jsonl with a failure class and, when the call
//     completed, the billed model/usage (never in results.jsonl)
//   - row ids, trace filenames, and frozen refs share one path-safe id
//     (original id kept in meta.original_id when sanitization changed it)

import { createHash } from 'node:crypto';
import { closeSync, constants as FS, existsSync, fstatSync, ftruncateSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Every output write refuses symlinks: the flow dir is model-influenced, and a
// prompt-injected round can plant `results.jsonl -> ~/.bashrc` where the next
// unattended run would append. POSIX opens O_NOFOLLOW (a symlink fails with
// ELOOP); Windows - where Node leaves O_NOFOLLOW undefined and Bun defines a
// meaningless value - lstat-refuses first. Symlinked parent dirs are
// refused the same way. Same discipline as the report builders' reads.
const WIN = process.platform === 'win32';
const NOFOLLOW = WIN ? 0 : FS.O_NOFOLLOW;
// A guard that cannot tell must refuse: only "no such entry" reads as absent;
// any other lstat failure (EACCES, ENAMETOOLONG, ...) is rethrown, never "no".
const lstatOrNull = p => { try { return lstatSync(p); } catch (e) { if (e?.code === 'ENOENT') return null; throw e; } };
const isSymlink = p => lstatOrNull(p)?.isSymbolicLink() === true;
// Stderr lines interpolate model-influenced bytes (case ids, error text that
// can echo model output, JSON.parse messages). Strip escape sequences and
// control characters, as build-report-lite.mjs's eprint does, so a planted
// OSC/CSI can't retitle the terminal or forge output lines.
const ESC_SEQ = /\x1b\[[0-?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[@-_]/g;
const CONTROL = /[\x00-\x1f\x7f-\x9f]/g;
const termSafe = s => String(s).replace(ESC_SEQ, '').replace(CONTROL, '');
const eprint = (...a) => console.error(...a.map(termSafe));
// The leaf checks above can't see a symlink on an INTERMEDIATE component
// (lstat and open both resolve those silently), so every open is also bound
// to the flow root: main() captures realpathSync(flow) once, and any path
// whose resolved parent leaves it - e.g. `vdir` or the flow dir itself
// replaced by a directory symlink - is refused when the check sees it.
// Residual, all platforms: the check and the open are separate path lookups
// (Node's sync fs has no openat-style call), so a directory swapped for a
// symlink in between is still followed. This stops a planted link, not a
// writer racing the run.
let flowRealRoot = null;
function assertInFlow(dir, what) {
  if (flowRealRoot == null) throw new Error(`refusing to ${what}: flow root not resolved yet`);
  const dirReal = realpathSync(dir);
  if (dirReal !== flowRealRoot && !dirReal.startsWith(flowRealRoot + (WIN ? '\\' : '/')))
    throw new Error(`refusing to ${what}: ${dir} resolves outside the flow directory`);
}
function openNoFollow(p, flags) {
  if (isSymlink(dirname(p))) throw new Error(`refusing to open through symlinked directory: ${dirname(p)}`);
  assertInFlow(dirname(p), 'open');
  if (WIN && isSymlink(p)) throw new Error(`refusing to open through symlink: ${p}`);
  const fd = openSync(p, flags | NOFOLLOW, 0o644);
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) throw new Error(`refusing to use non-regular file: ${p}`);
    // O_NOFOLLOW and lstat cannot see a hard link: a second name for a file
    // outside the flow dir opens as an ordinary regular file. Nothing the
    // runner creates has more than one link, so refuse any that does.
    if (st.nlink > 1) throw new Error(`refusing to use ${p}: it has a second hard link (another name for the same file); replace it with a plain copy if it is yours`);
  } catch (e) { closeSync(fd); throw e; }
  return fd;
}
// writeFileSync on the fd loops until every byte lands (a bare writeSync is
// one write(2) that may return short on ENOSPC and silently truncate a
// results row or trace).
// Opened without O_TRUNC and truncated only after openNoFollow's checks, so a
// refused file keeps its bytes.
function writeFileNoFollow(p, data) {
  const fd = openNoFollow(p, FS.O_WRONLY | FS.O_CREAT);
  try { ftruncateSync(fd, 0); writeFileSync(fd, data); } finally { closeSync(fd); }
}
// POSIX appends atomically under O_APPEND with no position. On Windows, Bun
// writes an O_APPEND handle at offset 0 unless given a position, so there the
// write starts at the current size and re-issues any short write.
function appendFileNoFollow(p, data) {
  const fd = openNoFollow(p, FS.O_WRONLY | FS.O_CREAT | FS.O_APPEND);
  try {
    if (!WIN) { writeFileSync(fd, data); return; }
    const buf = Buffer.from(data);
    const start = fstatSync(fd).size;
    for (let off = 0; off < buf.length;) {
      const n = writeSync(fd, buf, off, buf.length - off, start + off);
      if (n <= 0) throw new Error(`append to ${p} made no progress`);
      off += n;
    }
  } finally { closeSync(fd); }
}
// Reads of the frozen pairwise refs get the same discipline as writes (same
// open guard): the flow dir is model-influenced, so `baseline/ref/<id> ->
// ~/.ssh/id_rsa` planted after the startup preflight must not be read into
// the judge prompt. lexists probes with lstat so a planted symlink still
// counts as "present" at the freeze guard (never overwritten - or followed).
const lexists = p => lstatOrNull(p) != null;
function readFileNoFollow(p) {
  const fd = openNoFollow(p, FS.O_RDONLY);
  try { return readFileSync(fd, 'utf8'); } finally { closeSync(fd); }
}
// null when the file is absent; any other failure (a planted link included) throws.
function readIfPresent(p) {
  try { return readFileNoFollow(p); } catch (e) { if (e?.code === 'ENOENT') return null; throw e; }
}
function mkdirNoFollow(dir) {
  if (isSymlink(dir)) throw new Error(`refusing to use symlinked directory: ${dir}`);
  mkdirSync(dir, { recursive: true });
  // Check after creating: mkdirSync(recursive) follows symlinked ancestors,
  // so a dir minted through one resolves outside the flow root and is refused
  // here before any file lands in it.
  assertInFlow(dir, 'create directory');
}
// Frozen pairwise refs may carry an extension; reader and freeze-guard probe
// the same list so a suffixed ref never gets an extensionless shadow.
const REF_EXTS = ['', '.html', '.txt', '.json'];

// --- fill these in ----------------------------------------------------------
//
// Redproof `discover` eval. Each case copies a pinned open-source checkout into a
// fresh temp directory, runs `/redproof:discover` through headless Claude Code with
// only the locally built plugin loaded (isolated CLAUDE_CONFIG_DIR: no user skills,
// plugins, MCP servers or global CLAUDE.md), and stops the clock when discover
// launches its review UI ("report ready"). The handoff it wrote is then graded by
// deterministic checks plus a Claude Fable 5.1 judge (headless Claude Code, no tools,
// JSON-schema output) against judge-rubric.md.

import { spawn, execFileSync } from 'node:child_process';
import { cp, mkdtemp, readdir, readFile, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, extname } from 'node:path';
import { extractPicks, judgePicks } from './pick-judge.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');
const SHARED = join(REPO_ROOT, '.claude/hillclimb/_discover-shared');
const PLUGIN_DIR = process.env.REDPROOF_EVAL_PLUGIN_DIR ?? join(SHARED, 'redproof');
const REPOS_DIR = join(SHARED, 'repos');
const CONFIG_DIR = process.env.REDPROOF_EVAL_CONFIG_DIR ?? join(homedir(), '.claude-redproof-eval');
const JUDGE_MODEL = 'claude-fable-5-1';
// Set to a model id to also grade which Gates the handoff picks (pick-judge.mjs).
const PICKS_MODEL = process.env.REDPROOF_EVAL_PICKS || null;
// The maintainer judge flips about 1 in 4 Gate verdicts between passes; average this many.
const PICKS_PASSES = Math.max(1, Number(process.env.REDPROOF_EVAL_PICKS_PASSES ?? 2));
const PINNED = {
  ky: '3541888878c4d303a8bc2ad61815f4e048f55a5d',
  express: 'a419aa7350389a275ab45fde2e849ed1f02449ef',
  click: '2247b35ea1c47c727d7a06e51fa280e12a863ff6',
  chi: '3a33ba578e0dd93444e0ff386cc26e665d92e31e',
};
// Which judge criteria apply to which request style (cases.md tags[1]).
const APPLIES = {
  claims_first: new Set(['broad', 'timeboxed']),
  honours_scope: new Set(['narrow', 'priority', 'timeboxed', 'followup']),
};
const CRITERIA = ['leads_with_decision', 'repo_specific', 'claims_first', 'honours_scope', 'readable_newcomer', 'one_next_step'];
// $/MTok: [input, output, cache read]; cache writes priced at 1.25x (5m) / 2x (1h) input.
const PRICES = {
  'claude-opus-5-5': [4, 20, 0.2], 'claude-sonnet-5-5': [2, 10, 0.2],
  'claude-haiku-5-5': [0.1, 0.5, 0.01], 'claude-fable-5-1': [10, 50, 0.25],
};
// After discover launches the review UI: wait up to REPORT_GRACE_MS for review.html,
// then stop the server; the session must end on its own within POST_REPORT_CEILING_MS.
const REPORT_GRACE_MS = 30_000;
const POST_REPORT_CEILING_MS = 10 * 60_000;
// A session that has produced a result, has no background task pending and has been
// silent this long is finished; stop the process (it can linger on idle tasks).
const SESSION_IDLE_MS = 60_000;
// A turn that ends on the account limit is infrastructure, not a skill result.
const USAGE_LIMIT = /^You've hit your (session|usage|weekly) limit/;
// A real launch: `node <...>/review.mjs <review.json> --out <dir>`, not a read of the file.
const REVIEW_LAUNCH = /\bnode\b[^\n;&|]*\breview\.mjs\b[^\n;&|]*--out\b/;

/** Stop review servers this session started (its process group, or its review.json path). */
function stopReviewServers(pgid, reviewJson) {
  let ps = '';
  try { ps = execFileSync('ps', ['-A', '-o', 'pid=,pgid=,command='], { encoding: 'utf8' }); } catch { return; }
  for (const line of ps.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (m && (+m[2] === pgid || (reviewJson && m[3].includes(reviewJson))) && /review\.mjs/.test(m[3]) && !/\bclaude\b/.test(m[3].split(' ')[0])) {
      try { process.kill(+m[1], 'SIGTERM'); } catch {}
    }
  }
}

/** Usage and cost from the session's final `result` event (includes subagents). */
function usageFromResult(result) {
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const byModel = {};
  for (const [model, u] of Object.entries(result.modelUsage)) {
    const m = { input_tokens: u.inputTokens ?? 0, output_tokens: u.outputTokens ?? 0,
      cache_read_input_tokens: u.cacheReadInputTokens ?? 0, cache_creation_input_tokens: u.cacheCreationInputTokens ?? 0,
      cost_usd: u.costUSD };
    byModel[model] = m;
    for (const k of Object.keys(usage)) usage[k] += m[k];
  }
  return { usage, byModel, cost_usd: result.total_cost_usd ?? null, unpriced: [] };
}
// Plugins the eval account syncs from claude.ai; switched off per session. Any other
// non-built-in plugin fails the isolation guard. (Account-synced `anthropic-skills:*`
// cannot be switched off under OAuth; they are recorded per row instead.)
const SYNCED_PLUGINS_OFF = { enabledPlugins: Object.fromEntries(
  ["design", "engineering", "finance", "cowork-plugin-management"].map(p => [`${p}@synced`, false])) };

/** Return the list of input cases. Each must have a stable `id`. */
async function loadCases() {
  const md = readFileSync(join(HERE, 'cases.md'), 'utf8');
  const rows = [...md.matchAll(/^\| ([a-z]+-[a-z]+) \| ([^|]+?) \| ([^|]+?) \|$/gm)];
  const prompts = new Map([...md.matchAll(/^### (\S+)\n```text\n([\s\S]*?)\n```/gm)].map(m => [m[1], m[2]]));
  const cases = rows.map(([, id, tags]) => {
    const t = tags.split(',').map(s => s.trim());
    const [repo, style] = t;
    if (!PINNED[repo]) throw new Error(`case ${id}: unknown repo ${repo}`);
    if (!prompts.has(id)) throw new Error(`case ${id}: no prompt block in cases.md`);
    return { id, prompt: prompts.get(id), tags: t, meta: { repo, style, sha: PINNED[repo] } };
  });
  if (cases.length !== prompts.size) throw new Error(`cases.md: ${cases.length} table rows but ${prompts.size} prompt blocks`);
  // Optional subset for pilots: REDPROOF_EVAL_CASES=ky-timeboxed,click-narrow
  const only = process.env.REDPROOF_EVAL_CASES?.split(',').map(s => s.trim()).filter(Boolean);
  if (!only?.length) return cases;
  const unknown = only.filter(id => !cases.some(c => c.id === id));
  if (unknown.length) throw new Error(`REDPROOF_EVAL_CASES: unknown case ids ${unknown.join(', ')}`);
  return cases.filter(c => only.includes(c.id));
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env,
    GIT_AUTHOR_NAME: 'eval', GIT_AUTHOR_EMAIL: 'eval@localhost', GIT_COMMITTER_NAME: 'eval', GIT_COMMITTER_EMAIL: 'eval@localhost' } });
}

async function prepareWorkspace(input) {
  const ws = await mkdtemp(join(tmpdir(), `rp-discover-${input.id}-`));
  await cp(join(REPOS_DIR, input.meta.repo), ws, { recursive: true });
  if (git(ws, 'rev-parse', 'HEAD').trim() !== input.meta.sha) throw Object.assign(new Error(`workspace ${ws} not at pinned sha`), { failure_class: 'harness' });
  if (input.meta.style === 'followup') {
    // The prior discovery is part of the repo's history, so commit it.
    await cp(join(HERE, 'fixtures', input.meta.repo), ws, { recursive: true });
    git(ws, 'add', 'docs/redproof');
    git(ws, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'docs: record Redproof discovery (2026-09)');
  }
  return ws;
}

function priceOf(model) {
  const key = Object.keys(PRICES).find(k => String(model).startsWith(k));
  return key ? PRICES[key] : null;
}

/** Sum usage across every API message (main loop and subagents), priced per model. */
function aggregateUsage(byMessage) {
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const byModel = {};
  let cost = 0; const unpriced = new Set();
  for (const { model, u } of byMessage.values()) {
    const cw5 = u.cache_creation?.ephemeral_5m_input_tokens, cw1h = u.cache_creation?.ephemeral_1h_input_tokens;
    const cw = u.cache_creation_input_tokens ?? 0;
    usage.input_tokens += u.input_tokens ?? 0; usage.output_tokens += u.output_tokens ?? 0;
    usage.cache_read_input_tokens += u.cache_read_input_tokens ?? 0; usage.cache_creation_input_tokens += cw;
    const m = (byModel[model] ??= { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
    m.input_tokens += u.input_tokens ?? 0; m.output_tokens += u.output_tokens ?? 0;
    m.cache_read_input_tokens += u.cache_read_input_tokens ?? 0; m.cache_creation_input_tokens += cw;
    const p = priceOf(model);
    if (!p) { unpriced.add(model); continue; }
    const write = cw5 != null || cw1h != null ? (cw5 ?? 0) * 1.25 + (cw1h ?? 0) * 2 : cw * 1.25;
    cost += ((u.input_tokens ?? 0) * p[0] + write * p[0] + (u.output_tokens ?? 0) * p[1] + (u.cache_read_input_tokens ?? 0) * p[2]) / 1e6;
  }
  return { usage, byModel, cost_usd: unpriced.size ? null : cost, unpriced: [...unpriced] };
}

const textOf = c => typeof c === 'string' ? c
  : Array.isArray(c) ? c.map(b => b?.type === 'text' ? b.text : b?.type ? `[${b.type}]` : JSON.stringify(b)).join('\n')
  : JSON.stringify(c);

/** Parse `node .../review.mjs <review.json> --out <dir> [...]` from a Bash command. */
function parseReviewCommand(command, ws) {
  const cdTo = command.match(/(?:^|&&|;)\s*cd\s+("[^"]+"|'[^']+'|\S+)\s*(?:&&|;)/)?.[1]?.replace(/^["']|["']$/g, '');
  const base = cdTo ? resolve(ws, cdTo) : ws;
  const after = command.slice(command.indexOf('review.mjs') + 'review.mjs'.length).trim().split(/\s+/)
    .map(s => s.replace(/^["']|["']$/g, ''));
  const out = after.indexOf('--out') >= 0 ? after[after.indexOf('--out') + 1] : null;
  const json = after.find((s, i) => !s.startsWith('-') && after[i - 1] !== '--out' && after[i - 1] !== '--timeout');
  return { reviewJson: json ? resolve(base, json) : null, outDir: out ? resolve(base, out) : null,
    renderOnly: after.includes('--render-only') };
}

async function listFiles(dir, exts) {
  try {
    return (await readdir(dir, { recursive: true })).map(f => join(dir, f)).filter(f => exts.includes(extname(f)));
  } catch { return []; }
}

const REGRADE = process.env.REDPROOF_EVAL_REGRADE === '1';
const HANDOFF_EXTS = ['.md', '.html', '.json'];
const TEMP_PATH = /\/(?:private\/)?(?:tmp|var\/folders)\/[^\s'"`()<>|;&,*\\]+/g;
// Harness-made folders only: `rp-discover-<case id>-` / `rp-sess-<case id>-` plus mkdtemp's six
// characters. A session's own report folder may also start with `rp-discover-`.
const HARNESS_DIR = /\/rp-(discover|sess)-[a-z]+-(?:broad|narrow|priority|followup|timeboxed)-[A-Za-z0-9]{6}(?=\/|$)/;

/** The previously written row for (id, rep), kept as results.prev.jsonl when regrading. */
function previousRow(vdir, id, rep) {
  const rows = (readIfPresent(join(vdir, 'results.prev.jsonl')) ?? '').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const row = rows.find(r => r.prompt_id === id && r.rep === rep);
  if (!row) throw Object.assign(new Error(`regrade: no previous row for ${id} rep${rep} in results.prev.jsonl`), { failure_class: 'harness' });
  return row;
}

/**
 * Handoff files the session named by absolute temp path (in commands, tool output or
 * its messages). A named folder contributes its handoff files, two levels deep. Other
 * cases' workspaces and private TMPDIRs, Claude's own task output and the temp root
 * itself are never scanned.
 */
async function mentionedArtifacts(texts, ownTmp) {
  const roots = new Set(['/tmp', '/private/tmp', tmpdir().replace(/\/$/, ''), realpathSync(tmpdir()).replace(/\/$/, '')]);
  const found = new Set();
  for (const text of texts) for (const [m] of String(text ?? '').matchAll(TEMP_PATH)) {
    const p = m.replace(/[.:\]]+$/, '');
    if (roots.has(p.replace(/\/$/, '')) || /\/claude-\d+\//.test(p) || p.includes('/node_modules/')) continue;
    const harnessDir = p.match(HARNESS_DIR);
    if (harnessDir && (harnessDir[1] === 'discover' || !(ownTmp && p.startsWith(ownTmp)))) continue;
    const st = lstatOrNull(p);
    if (!st) continue;
    if (st.isFile() && HANDOFF_EXTS.includes(extname(p))) found.add(p);
    else if (st.isDirectory()) {
      for (const f of await listFiles(p, HANDOFF_EXTS))
        if (f.slice(p.length + 1).split('/').length <= 3) found.add(f);
    }
  }
  return found;
}

/**
 * Run the app on one input. Return everything the grader and the report need.
 * `ctx.model` and `ctx.variant` are the CLI args; use them to pick the model
 * and (for hillclimb) the harness/prompt under test.
 */
async function runCase(input, ctx) {
  const vdir = join(ctx.flow, ctx.variant);
  const key = `${pathSafeId(input.id)}_rep${ctx.rep}`;
  mkdirNoFollow(join(vdir, 'raw')); mkdirNoFollow(join(vdir, 'out')); mkdirNoFollow(join(vdir, 'out', key));
  const rawPath = join(vdir, 'raw', `${key}.jsonl`);
  // Leave ~10 minutes of the case ceiling for collection and judging.
  const runCeilingMs = Math.max(600, (ctx.timeoutS || 3600) - 600) * 1000;

  // Regrade replays the saved session stream against its kept workspace instead of
  // launching discover again; timings come from the row being regraded.
  let ws, sessTmp = null, prev = null, rawLines = null;
  if (REGRADE) {
    prev = previousRow(vdir, pathSafeId(input.id), ctx.rep);
    rawLines = readFileNoFollow(rawPath).split('\n').filter(l => l.trim());
    ws = rawLines.map(l => { try { return JSON.parse(l); } catch { return null; } })
      .find(d => d?.type === 'system' && d.subtype === 'init')?.cwd;
    if (!ws || !existsSync(ws)) throw Object.assign(new Error(`regrade: workspace ${ws} is gone`), { failure_class: 'harness' });
  } else {
    ws = await prepareWorkspace(input);
    // A private TMPDIR, so files the session creates with mktemp are attributable to it.
    sessTmp = await mkdtemp(join(tmpdir(), `rp-sess-${input.id}-`));
  }

  const args = ['-p', input.prompt, '--model', ctx.model, '--plugin-dir', PLUGIN_DIR,
    '--output-format', 'stream-json', '--verbose', '--no-session-persistence',
    '--permission-mode', 'bypassPermissions', '--strict-mcp-config',
    '--settings', JSON.stringify(SYNCED_PLUGINS_OFF)];
  const t0 = Date.now();
  const child = REGRADE ? null : spawn('claude', args, { cwd: ws, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CLAUDE_CONFIG_DIR: CONFIG_DIR, TMPDIR: sessTmp + '/',
      // No-op `open`/`xdg-open`: the review page must not pop up on the eval machine.
      PATH: `${join(HERE, 'stubs')}:${process.env.PATH}` } });
  if (!REGRADE) writeFileNoFollow(rawPath, '');

  const transcript = [{ role: 'user', content: input.prompt }];
  const usageByMessage = new Map();
  const topLevelMessages = new Set();
  const written = new Set();
  const skillsInvoked = [];
  let init = null, result = null, toolCalls = 0, subagents = 0, stderr = '';
  let report = null; // { atMs, toolUseId, command }
  let endReason = 'session_ended', killed = false, postReportTimer = null, lastEventAt = Date.now();
  const pendingTasks = new Set(); // background agents/shells the session is still waiting on
  let usageLimitHit = null; // any turn that ended on the account usage limit voids the run

  const kill = () => { if (killed || !child) return; killed = true; try { process.kill(-child.pid, 'SIGTERM'); } catch {} };
  // "Report ready" = discover launched its review page. Wait for review.html to
  // land, then stop only the review server so the session ends on its own and its
  // final `result` event carries the real usage and cost. Hard stop if it lingers.
  const onReportLaunched = () => {
    const { outDir, reviewJson } = parseReviewCommand(report.command, ws);
    const started = Date.now();
    const poll = setInterval(() => {
      const rendered = outDir && existsSync(join(outDir, 'review.html'));
      if (!rendered && Date.now() - started < REPORT_GRACE_MS) return;
      clearInterval(poll);
      report.rendered = rendered;
      stopReviewServers(child.pid, reviewJson);
    }, 1_000);
    postReportTimer = setTimeout(() => { endReason = 'post_report_hang'; kill(); }, POST_REPORT_CEILING_MS);
  };
  const handle = ev => {
    const sub = ev.parent_tool_use_id ? '[subagent] ' : '';
    lastEventAt = Date.now();
    if (ev.type === 'system' && ev.subtype === 'task_started' && ev.task_id) pendingTasks.add(ev.task_id);
    else if (ev.type === 'system' && ev.subtype === 'task_notification' && ev.task_id) pendingTasks.delete(ev.task_id);
    if (ev.type === 'system' && ev.subtype === 'init') init = ev;
    else if (ev.type === 'assistant' && ev.message) {
      const m = ev.message;
      if (m.id && m.usage) usageByMessage.set(m.id, { model: m.model, u: m.usage });
      if (!ev.parent_tool_use_id && m.id) topLevelMessages.add(m.id);
      for (const b of m.content ?? []) {
        if (b.type === 'text' && b.text?.trim()) transcript.push({ role: 'assistant', content: sub + b.text });
        else if (b.type === 'thinking' && b.thinking) transcript.push({ role: 'assistant', content: '', thinking: sub + b.thinking });
        else if (b.type === 'tool_use') {
          toolCalls++;
          transcript.push({ role: 'tool_call', name: sub + b.name, content: JSON.stringify(b.input, null, 2) });
          if (!ev.parent_tool_use_id && (b.name === 'Agent' || b.name === 'Task')) subagents++;
          if (b.name === 'Write' && b.input?.file_path) written.add(resolve(ws, b.input.file_path));
          if (b.name === 'Skill') skillsInvoked.push(b.input?.skill ?? b.input?.command ?? JSON.stringify(b.input));
          if (!report && b.name === 'Bash' && REVIEW_LAUNCH.test(b.input?.command ?? '')) {
            report = { atMs: REGRADE ? (prev.report_s ?? 0) * 1000 : Date.now() - t0, toolUseId: b.id, command: b.input.command };
            if (!REGRADE) onReportLaunched();
          }
        }
      }
    } else if (ev.type === 'user' && ev.message) {
      for (const b of Array.isArray(ev.message.content) ? ev.message.content : []) {
        if (b.type !== 'tool_result') continue;
        transcript.push({ role: 'tool_result', content: sub + textOf(b.content) });
      }
    } else if (ev.type === 'result') {
      // A turn ended. The session may resume when a background task reports back, so
      // it is stopped only once idle (see SESSION_IDLE_MS); the last result is the total.
      result = ev;
      if (USAGE_LIMIT.test(String(ev.result ?? ''))) usageLimitHit = String(ev.result);
    }
  };

  if (REGRADE) for (const line of rawLines) { try { handle(JSON.parse(line)); } catch {} }
  else await new Promise((resolveRun, rejectRun) => {
    const ceiling = setTimeout(() => { endReason = 'timeout'; kill(); }, runCeilingMs);
    const idle = setInterval(() => {
      if (result && !pendingTasks.size && Date.now() - lastEventAt > SESSION_IDLE_MS) kill();
    }, 5_000);
    let buf = '';
    child.stdout.on('data', d => {
      appendFileNoFollow(rawPath, d);
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        try { handle(JSON.parse(line)); } catch {}
      }
    });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', e => { clearTimeout(ceiling); rejectRun(e); });
    child.on('close', () => { clearTimeout(ceiling); clearInterval(idle); clearTimeout(postReportTimer); resolveRun(); });
  });
  const wallMs = REGRADE ? (prev.wall_s ?? 0) * 1000 : Date.now() - t0;
  if (REGRADE && prev.end_reason === 'post_report_hang') endReason = 'post_report_hang';
  // Streamed per-message usage carries placeholder output counts; the final
  // `result` event is authoritative. It is missing only when the harness killed
  // the session (timeout / post-report hang), and then the stream sum undercounts.
  const agg = result?.modelUsage ? usageFromResult(result) : { ...aggregateUsage(usageByMessage), partial: true };

  const fail = (failure_class, message) => Object.assign(new Error(message), {
    failure_class, model: init?.model, usage: agg.usage });
  if (!init) throw fail('harness', `claude produced no init event: ${termSafe(stderr.slice(0, 500))}`);
  // Isolation guard: only the built plugin's skills may be loaded, never a user-level copy.
  const skills = (init.skills ?? []).map(String);
  if (!skills.includes('redproof:discover')) throw fail('harness', 'redproof:discover not loaded');
  if ((init.mcp_servers ?? []).length) throw fail('harness', `MCP servers loaded: ${init.mcp_servers.map(m => m.name).join(',')}`);
  if (skills.some(s => /redproof/.test(s) && !s.startsWith('redproof:')) || (init.plugins ?? []).some(p => p.name !== 'redproof' && !String(p.source).endsWith('@builtin')))
    throw fail('harness', `session not isolated: plugins=${(init.plugins ?? []).map(p => p.name).join(',')}`);
  if (result?.is_error && /not logged in|login/i.test(String(result.result))) throw fail('harness', `auth: ${result.result}`);
  if (usageLimitHit) throw fail('harness', `usage limit during session: ${usageLimitHit.slice(0, 120)}`);
  if (endReason === 'timeout') throw fail('timeout', `no report within ${runCeilingMs / 1000}s`);
  if (result?.is_error && !report) throw fail('error', `session error: ${String(result.result).slice(0, 300)}`);

  // Collect the handoff wherever the session put it: Write-tool files, new files in
  // the workspace, the review page directory, the session's private TMPDIR, and any
  // temp-dir file or folder the session named (shell heredocs never pass through Write).
  const review = report ? parseReviewCommand(report.command, ws) : null;
  const status = git(ws, 'status', '--porcelain', '--untracked-files=all').split('\n').filter(Boolean);
  const trackedEdits = status.filter(l => !l.startsWith('??'));
  const untracked = status.filter(l => l.startsWith('??')).map(l => resolve(ws, l.slice(3)));
  const candidates = new Set([...written, ...untracked]);
  if (review?.reviewJson) candidates.add(review.reviewJson);
  if (review?.outDir) for (const f of await listFiles(review.outDir, ['.html', '.json'])) candidates.add(f);
  if (sessTmp) for (const f of await listFiles(sessTmp, ['.md', '.html', '.json'])) candidates.add(f);
  const finalForScan = result?.result ?? '';
  for (const f of await mentionedArtifacts([...transcript.map(t => t.content), finalForScan], sessTmp)) candidates.add(f);
  const artifacts = [];
  for (const src of candidates) {
    if (!['.md', '.html', '.json'].includes(extname(src)) || src.includes('/node_modules/')) continue;
    try { if (!(await stat(src)).isFile()) continue; } catch { continue; }
    const rel = src.startsWith(ws + '/') ? src.slice(ws.length + 1) : `external/${basename(dirname(src))}/${basename(src)}`;
    const dest = join(vdir, 'out', key, rel.replace(/[^\w./-]/g, '_'));
    mkdirNoFollow(dirname(dest));
    writeFileNoFollow(dest, await readFile(src));
    artifacts.push({ rel, path: dest, ext: extname(src), isReviewJson: src === review?.reviewJson });
  }
  const finalText = result?.result ?? transcript.filter(t => t.role === 'assistant' && t.content).at(-1)?.content ?? '';
  const wroteHandoff = artifacts.some(a => a.ext === '.md' || a.ext === '.html');
  if (endReason === 'session_ended')
    endReason = report ? 'report_ready' : wroteHandoff ? 'files_no_review' : result && !result.is_error ? 'answered_in_chat' : 'session_ended';
  transcript.push({ role: 'assistant', content: `[harness] end: ${endReason}; report ready at ${report ? (report.atMs / 1000).toFixed(0) + 's' : 'never'}; workspace ${ws}`,
    attachments: artifacts.filter(a => a.ext === '.html').map(a => ({ kind: 'html', ref: relative(ctx.flow, a.path) })) });

  const primaryMd = artifacts.filter(a => a.ext === '.md').sort((a, b) => a.rel.length - b.rel.length)[0];
  return {
    output: primaryMd ? readFileSync(primaryMd.path, 'utf8') : finalText,
    transcript, model: init.model, usage: agg.usage, stop_reason: endReason, status: 'ok',
    ws, report, review, artifacts, trackedEdits, skillsInvoked, finalText,
    perf: {
      // Without a review page, the handoff is ready when the session ends.
      // A regrade with no recorded timing reports it as missing, never as 0.
      report_s: REGRADE && prev.report_s == null ? null
        : report ? +(report.atMs / 1000).toFixed(1) : ['answered_in_chat', 'files_no_review'].includes(endReason) ? +(wallMs / 1000).toFixed(1) : null,
      wall_s: REGRADE && prev.wall_s == null ? null : +(wallMs / 1000).toFixed(1),
      cost_usd: agg.cost_usd == null ? null : +agg.cost_usd.toFixed(4),
      in_tokens: agg.usage.input_tokens + agg.usage.cache_read_input_tokens + agg.usage.cache_creation_input_tokens,
      out_tokens: agg.usage.output_tokens, turns: topLevelMessages.size, tool_calls: toolCalls, subagents,
    },
    usage_by_model: agg.byModel, unpriced_models: agg.unpriced, usage_partial: !!agg.partial,
    account_skills: skills.filter(s => s.startsWith('anthropic-skills:')),
  };
}

// The judge reads the page structure (headings, <details>, sections), minus scripts/styles.
const htmlForJudge = h => h.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/\n\s*\n+/g, '\n').trim();
/**
 * Backticked repo paths cited in the handoff, checked against the workspace. A bare
 * file name (`core.py`) resolves if any tracked file has that name; a path with a
 * directory must exist as written. Flags, URLs and the handoff's own files are skipped.
 */
function citedPaths(text, ws, ownFiles) {
  const tracked = git(ws, 'ls-files').split('\n').filter(Boolean);
  const names = new Set(tracked.map(f => basename(f)));
  const seen = new Set();
  for (const [, raw] of text.matchAll(/`([^`\s]+)`/g)) {
    const p = raw.replace(/[#:].*$/, '').replace(/^\.\//, '');
    if (!/\.(md|ts|js|mjs|cjs|py|json|toml|ya?ml|txt|rst)$/.test(p) && !(p.includes('/') && existsSync(join(ws, p)))) continue;
    if (/^[-/]/.test(p) || /^https?:/.test(p) || p.includes('..') || /[*{}<>$]/.test(p) || ownFiles.has(basename(p))) continue;
    seen.add(p);
  }
  const paths = [...seen];
  const missing = paths.filter(p => p.includes('/') ? !existsSync(join(ws, p)) : !names.has(p));
  return { paths, missing };
}

const JUDGE_SCHEMA = {
  type: 'object', additionalProperties: false, required: CRITERIA,
  properties: Object.fromEntries(CRITERIA.map(c => [c, {
    type: 'object', additionalProperties: false, required: ['pass', 'reason'],
    properties: { pass: { type: ['boolean', 'null'] }, reason: { type: 'string' } },
  }])),
};

function runJudge(prompt) {
  return new Promise((resolveJ, rejectJ) => {
    const child = spawn('claude', ['-p', '--model', JUDGE_MODEL, '--tools', '', '--output-format', 'json',
      '--no-session-persistence', '--strict-mcp-config', '--system-prompt', readFileSync(join(HERE, 'judge-rubric.md'), 'utf8'),
      '--json-schema', JSON.stringify(JUDGE_SCHEMA)],
    { cwd: tmpdir(), stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, CLAUDE_CONFIG_DIR: CONFIG_DIR } });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', rejectJ);
    child.on('close', code => {
      let res;
      try { res = JSON.parse(out); } catch { return rejectJ(Object.assign(new Error(`judge exit ${code}: ${termSafe((err || out).slice(0, 300))}`), { failure_class: 'judge_error' })); }
      const judge_usage = res.usage, judge_model = Object.keys(res.modelUsage ?? {})[0] ?? JUDGE_MODEL;
      let verdict = res.structured_output;
      if (!verdict) try { verdict = JSON.parse(res.result); } catch {}
      if (res.is_error || !verdict) return rejectJ(Object.assign(new Error(`judge failed: ${termSafe(String(res.result).slice(0, 300))}`),
        { failure_class: 'judge_error', judge_model, judge_usage }));
      resolveJ({ verdict, judge_model, judge_usage, judge_cost_usd: res.total_cost_usd });
    });
    child.stdin.end(prompt);
  });
}

/**
 * Grade one output. For pairwise, `ref` is the FROZEN baseline output read
 * from disk (baseline/ref/<id>.*) - never a freshly co-generated one.
 * Return { grade: {metric_id: number, ...}, explanation?: {metric_id: string},
 *          judge_model?, judge_usage? }.
 * If the judge call succeeded but grading still fails (parse error, bad
 * schema), attach judge_model/judge_usage to the thrown error - the errors
 * sidecar reads them so billed judge spend on failed attempts stays counted.
 */
async function gradeCase(input, run, ref, ctx) {
  const grade = {}, explanation = {};
  const md = run.artifacts.filter(a => a.ext === '.md');
  const html = run.artifacts.filter(a => a.ext === '.html');
  // The server's own snapshot is exactly what the page rendered; the launch-command
  // path is only a fallback (it may be relative to an unknown directory or renamed).
  const reviewJson = run.artifacts.find(a => basename(a.rel) === 'review.snapshot.json') ?? run.artifacts.find(a => a.isReviewJson);

  // Deterministic checks.
  grade.report_ready = run.report ? 1 : 0;
  explanation.report_ready = run.report ? `review UI launched at ${run.perf.report_s}s (${run.review?.renderOnly ? 'render-only' : 'served'})`
    : `no review UI launched; session ${run.stop_reason}. Final message: ${run.finalText.slice(0, 300)}`;
  grade.has_md_and_html = md.length && html.length ? 1 : 0;
  explanation.has_md_and_html = `${md.length} Markdown, ${html.length} HTML: ${run.artifacts.map(a => a.rel).join(', ') || 'none'}`;
  let gates = null;
  if (reviewJson) try { gates = JSON.parse(readFileSync(reviewJson.path, 'utf8')).gates; } catch {}
  const missingDescribe = Array.isArray(gates) ? gates.filter(g => !String(g?.describe ?? '').trim()).map(g => g?.id ?? '?') : null;
  grade.describe_complete = Array.isArray(gates) && gates.length && !missingDescribe.length ? 1 : 0;
  explanation.describe_complete = !Array.isArray(gates) ? 'no readable review.json gates'
    : `${gates.length} gates; missing describe: ${missingDescribe.join(', ') || 'none'}`;
  grade.no_tracked_edits = run.trackedEdits.length ? 0 : 1;
  explanation.no_tracked_edits = run.trackedEdits.length ? `modified: ${run.trackedEdits.join('; ')}` : 'no tracked files changed';
  const advanced = run.skillsInvoked.filter(s => /design|build/.test(s));
  grade.no_unauthorized_advance = advanced.length ? 0 : 1;
  explanation.no_unauthorized_advance = advanced.length ? `invoked ${advanced.join(', ')} without a review decision` : 'stayed in discovery';
  const handoffText = [...md, ...html].map(a => readFileSync(a.path, 'utf8')).join('\n');
  const cited = citedPaths(handoffText + '\n' + run.finalText, run.ws, new Set(run.artifacts.map(a => basename(a.rel))));
  if (cited.paths.length) {
    grade.paths_resolve = +((cited.paths.length - cited.missing.length) / cited.paths.length).toFixed(3);
    explanation.paths_resolve = `${cited.paths.length - cited.missing.length}/${cited.paths.length} cited paths exist; missing: ${cited.missing.slice(0, 10).join(', ') || 'none'}`;
  }

  // Judge. A run with no handoff fails every judged criterion without a call.
  if (!md.length && !html.length && !run.finalText.trim()) {
    for (const c of CRITERIA) { grade[c] = 0; explanation[c] = 'no handoff produced'; }
    grade.quality = 0; explanation.quality = 'no handoff produced';
    return { grade, explanation };
  }
  const style = input.meta.style;
  const applicability = CRITERIA.map(c => `- ${c}: ${APPLIES[c] && !APPLIES[c].has(style) ? 'not applicable (return pass: null)' : 'applies'}`).join('\n');
  const parts = [
    `<request style="${style}" repository="${input.meta.repo}">\n${input.prompt}\n</request>`,
    `Criterion applicability for this case:\n${applicability}`,
    ...md.map(a => `<artifact kind="markdown" path="${a.rel}">\n${readFileSync(a.path, 'utf8')}\n</artifact>`),
    ...html.map(a => `<artifact kind="html" path="${a.rel}" note="scripts and styles removed">\n${htmlForJudge(readFileSync(a.path, 'utf8'))}\n</artifact>`),
    `<final_message${md.length || html.length ? '' : ' note="No files were written; this message is the whole handoff."'}>\n${run.finalText}\n</final_message>`,
  ];
  const prompt = parts.join('\n\n');
  if (prompt.length > 1_500_000) throw Object.assign(new Error(`judge input ${prompt.length} chars exceeds limit`), { failure_class: 'judge_input_too_large' });
  const j = await runJudge(prompt);
  let passed = 0, applicable = 0;
  for (const c of CRITERIA) {
    const v = j.verdict[c];
    const na = APPLIES[c] && !APPLIES[c].has(style);
    if (na || v?.pass == null) { explanation[c] = `n/a: ${v?.reason ?? ''}`; continue; }
    grade[c] = v.pass ? 1 : 0; explanation[c] = v.reason;
    applicable++; passed += grade[c];
  }
  grade.quality = applicable ? +(passed / applicable).toFixed(3) : 0;
  explanation.quality = `${passed}/${applicable} applicable criteria passed`;
  run.perf.judge_cost_usd = j.judge_cost_usd == null ? null : +j.judge_cost_usd.toFixed(4);

  // Gate choice: would this repository's maintainer merge what the handoff recommends?
  if (PICKS_MODEL) {
    const picks = extractPicks({ jsonFiles: reviewJson ? [reviewJson.path] : [],
      mdTexts: md.map(a => readFileSync(a.path, 'utf8')), finalText: run.finalText });
    grade.pick_n = picks.length;
    // No Gates proposed: the maintainer judges the "nothing uncovered" claim instead.
    const handoff = [...md.map(a => readFileSync(a.path, 'utf8')), run.finalText].join('\n\n');
    {
      const passes = [];
      for (let k = 0; k < PICKS_PASSES; k++) passes.push(await judgePicks({ repo: input.meta.repo, request: input.prompt, picks, model: PICKS_MODEL, handoff }));
      const mean = xs => +(xs.reduce((t, x) => t + x, 0) / xs.length).toFixed(3);
      grade.pick_score = mean(passes.map(pj => pj.score));
      if (picks.length) grade.pick_gate_pr = mean(passes.flatMap(pj => pj.verdicts.map(v => ({ yes: 1, maybe: 0.5, no: 0 })[v.gate_pr])));
      explanation.pick_score = passes.map((pj, k) => `pass ${k + 1} (${pj.score}): ` + (pj.none
        ? `no Gates proposed; maintainer agrees ${pj.none.agree}${pj.none.missed ? `, missed: ${pj.none.missed}` : ''} - ${pj.none.reason}`
        : pj.verdicts.map(v => `${v.gate}: plain ${v.plain_test}, covered ${v.covered}, accurate ${v.accurate}, gate ${v.gate_pr} - ${v.reason}`).join(' | '))).join(' || ');
      run.perf.judge_cost_usd = +((run.perf.judge_cost_usd ?? 0) + passes.reduce((t, pj) => t + (pj.judge_cost_usd ?? 0), 0)).toFixed(4);
    }
  }
  return { grade, explanation, judge_model: j.judge_model, judge_usage: j.judge_usage };
}

/** Side-channel perf fields beyond the built-ins (latency_s etc.). */
function perfFrom(run) { return { ...run.perf, end_reason: run.stop_reason, usage_by_model: run.usage_by_model, account_skills: run.account_skills }; }

// --- harness (you usually won't need to touch below this line) --------------

function parseArgs(argv) {
  const a = { flow: '.claude/hillclimb/flow', variant: 'baseline',
              model: undefined, reps: 1, concurrency: 4, timeoutS: 1800,
              approveHarness: false };
  // A flag at the end of argv would otherwise consume undefined - which for
  // --model equals the default and silently disables the served-model check.
  const val = (i) => { if (argv[i] === undefined) { eprint(`missing value for ${argv[i - 1]}`); usage(); process.exit(2); } return argv[i]; };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--flow') a.flow = val(++i);
    else if (k === '--variant') a.variant = val(++i);
    else if (k === '--model') a.model = val(++i);
    else if (k === '--reps') a.reps = +val(++i);
    else if (k === '--concurrency') a.concurrency = +val(++i);
    else if (k === '--timeout-s') a.timeoutS = +val(++i);
    else if (k === '--approve-harness') a.approveHarness = true;
    else if (k === '-h' || k === '--help') { usage(); process.exit(0); }
    else { eprint(`unknown argument: ${k}`); usage(); process.exit(2); }
  }
  if (!/^(baseline|v[1-9]\d*)$/.test(a.variant)) {
    // The report only reads directories named 'baseline' or 'v<N>' - any other
    // name runs to completion but spends the pass into a directory the Summary,
    // trajectory, and budget arithmetic never see.
    eprint(`--variant must be 'baseline' or 'v<N>', got '${a.variant}'`);
    usage(); process.exit(2);
  }
  if (!Number.isFinite(a.timeoutS) || a.timeoutS < 0
      || a.timeoutS * 1000 > 2147483647 // setTimeout clamps >2^31-1 ms to 1 ms - the ceiling would fire instantly
      || !Number.isInteger(a.reps) || a.reps < 1
      || !Number.isInteger(a.concurrency) || a.concurrency < 1) { usage(); process.exit(2); }
  return a;
}
function usage() {
  eprint('usage: node run-eval.mjs --flow DIR --variant ID [--model ID] [--reps N] [--concurrency N] [--timeout-s N (0 = no ceiling)] [--approve-harness]');
}

// Harness integrity gate. The hillclimb loop gets this runner command
// allowlisted for the session and then runs rounds unattended, while the
// per-round change (proposed by an analyzer fed untrusted transcripts) may
// legitimately edit harness code. Without this gate a round that rewrites the
// runner would execute attacker-chosen code on the next unattended run under
// the user's one-time approval. So: sha256 over this file, any lockfile
// beside it or in the directory the runner is invoked from (dependency drift
// is harness drift too; with neither, a note says so), plus
// every path in `_state.json.harness_paths` (relative to the directory the
// runner is invoked from, i.e. the repo root); compare to
// `_state.json.harness_sha`; refuse on absent/mismatch unless a human passes
// --approve-harness, which records the new sha. That write is the one
// sanctioned exception to "never write _state.json".
//
// Scope, stated plainly: this is a change detector, not a security boundary.
// The sha, the path list and this file all live where the loop agent can
// write, so an agent that is already prompt-injected can forge the record or
// pass --approve-harness itself. What it catches is the common case - a
// round's harness edit reaching an unattended run unreviewed - and what
// actually bounds an unattended run is the permission allowlist the user
// grants the runner command (scope it to this exact command line, not a
// prefix). Installed dependencies beyond the lockfile are outside the digest.
function checkHarness(statePath, st, approve) {
  const self = fileURLToPath(import.meta.url);
  const listed = Array.isArray(st.harness_paths) ? st.harness_paths.map(String) : [];
  const lockfiles = [...new Set([dirname(self), process.cwd()].flatMap(d =>
    ['package-lock.json', 'bun.lock', 'bun.lockb', 'yarn.lock', 'pnpm-lock.yaml'].map(f => join(d, f))))]
    .filter(f => existsSync(f));
  const paths = [...new Set([self, ...lockfiles, ...listed.map(p => resolve(p))])].sort();
  const h = createHash('sha256');
  const hashed = [];
  for (const p of paths) {
    let buf;
    try { buf = readFileSync(p); }
    catch (e) {
      if (p === self) throw e;
      eprint(`warning: harness path '${relative(process.cwd(), p)}' not readable (${e?.code || 'error'}) - skipped`);
      continue;
    }
    h.update(relative(process.cwd(), p)).update('\0').update(buf).update('\0');
    hashed.push(relative(process.cwd(), p));
  }
  const sha = h.digest('hex');
  if (st.harness_sha === sha) return;
  // Said only here, where a person is about to approve or is being refused.
  if (!lockfiles.length) eprint('note: no lockfile beside the runner or in the current directory - dependency changes are outside the harness sha');
  if (approve) {
    st.harness_sha = sha;
    writeFileNoFollow(statePath, JSON.stringify(st, null, 2) + '\n');
    eprint(`harness approved: sha256 ${sha.slice(0, 12)} over ${hashed.length} file(s) recorded in ${statePath}`);
    return;
  }
  if (st.harness_sha == null) {
    eprint(`no approved harness sha in ${statePath} (computed ${sha.slice(0, 12)} over: ${hashed.join(', ')}).`);
    eprint('Review the harness, then run once with --approve-harness to record it.');
  } else {
    eprint(`harness changed since last approved run (files: ${hashed.join(', ')}); `
      + `approved ${String(st.harness_sha).slice(0, 12)}, now ${sha.slice(0, 12)}.`);
    eprint('Re-run with --approve-harness after reviewing the diff.');
  }
  process.exit(2);
}

// Transient provider errors (429 / overloaded / 5xx) retry with jittered
// exponential backoff - a zero-delay retry loop multiplies cost invisibly
// under rate limits and can turn one transient 429 into a torn-down batch.
// The attempt count lands in the row's meta (or the errors sidecar) so retry
// churn is visible in the data, not just the bill.
async function withBackoff(fn, retry, deadline = Infinity, tries = 5) {
  for (let attempt = 0; ; attempt++) {
    // Checked before every attempt, not just before sleeps: once the case's
    // ceiling has passed, an abandoned chain must not issue another call
    // (e.g. a judge call after the app call consumed the whole ceiling).
    if (Date.now() >= deadline) {
      const e = new Error('wall-clock ceiling exceeded before attempt');
      e.failure_class = 'timeout';
      throw e;
    }
    try { return await fn(); } catch (e) {
      const status = e?.status ?? e?.response?.status;
      const transient = status === 429 || status === 529 || (status >= 500 && status < 600)
        || /overloaded|rate.?limit/i.test(String(e?.message ?? ''));
      if (!transient || attempt >= tries - 1) throw e;
      const delay = Math.min(60_000, 1000 * 2 ** attempt) * (0.5 + Math.random());
      // Never start a retry that would outlive the case's wall-clock ceiling - 
      // otherwise an abandoned chain keeps issuing API calls after the case failed.
      if (Date.now() + delay >= deadline) throw e;
      retry.count++;
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// Hard per-case wall-clock ceiling, independent of stream liveness - a hung
// SSE stream can emit keepalives forever, defeating inactivity-based timers.
// The underlying call may keep running; the case fails and the slot is freed.
function withTimeout(promise, seconds, label) {
  if (!(seconds > 0)) return promise;
  let timer;
  const ceiling = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const e = new Error(`${label}: exceeded ${seconds}s wall-clock ceiling`);
      e.failure_class = 'timeout';
      reject(e);
    }, seconds * 1000);
  });
  return Promise.race([promise, ceiling]).finally(() => clearTimeout(timer));
}

// Case ids appear in file paths AND as the row/file join key the report uses,
// so rows, trace filenames, and frozen refs all carry the same path-safe id.
// When sanitization changes the id, a short content hash keeps distinct ids
// distinct ('case/1' vs 'case_1'); the original rides in meta.original_id.
function pathSafeId(id) {
  const raw = String(id);
  const cleaned = raw.replace(/[^\w.-]/g, '_');
  // Idempotent by construction: anything already path-safe and within the
  // length bound - including this function's own truncated+suffixed output - 
  // passes through unchanged. Long ids (URLs, prompt text as id) truncate to
  // 120 chars plus an 8-hex hash of the full original, so they fail here, not
  // at the trace write after the spend, and distinct ids stay distinct.
  if (cleaned === raw && raw.length <= 129) return raw;
  return `${cleaned.slice(0, 120)}-${createHash('sha256').update(raw).digest('hex').slice(0, 8)}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // lstat("link/") follows the final symlink, so a trailing separator on
  // --flow would blind every leaf isSymlink check below - strip it first.
  // Only Windows treats `\` as a separator; on POSIX it is a filename byte, so
  // splitting on it would walk prefixes that are not real path components.
  args.flow = args.flow.replace(WIN ? /(.)[\\/]+$/ : /(.)\/+$/, '$1');
  const flowSegments = args.flow.split(WIN ? /[\\/]/ : '/');
  // A `.`/`..` segment (e.g. a trailing `/.`) makes isSymlink(args.flow) below
  // resolve a different final component than the named dir - following a
  // planted link at the flow root - while join() collapses it and the absolute
  // branch skips the ancestor walk. Refuse dot segments outright
  // (absolute --flow stays supported).
  if (flowSegments.some(seg => seg === '.' || seg === '..')) {
    eprint(`refusing to run: --flow must not contain '.' or '..' segments, got '${args.flow}'`);
    process.exit(2);
  }
  const vdir = join(args.flow, args.variant);
  // Preflight every output path before the first model call: a planted
  // symlink would otherwise fail each case after its (billed) run.
  for (const p of [args.flow, join(args.flow, 'baseline'), vdir, join(vdir, 'traces'),
                   join(vdir, 'results.jsonl'), join(vdir, 'errors.jsonl'),
                   join(vdir, 'progress.txt'), join(args.flow, 'baseline', 'ref'), join(args.flow, '_state.json')])
    if (isSymlink(p)) { eprint(`refusing to run: ${p} is a symlink (the flow dir must hold regular files)`); process.exit(2); }
  // A relative --flow (the documented `.claude/hillclimb/<name>` layout) is
  // also lstat-walked component by component from the cwd: a pre-planted
  // link at an ancestor (`.claude/hillclimb -> elsewhere`) would otherwise
  // relocate the root capture below - the containment anchor itself - to the
  // attacker's target. An absolute --flow is the caller's own trust decision
  // and is not walked (an absolute ancestor link can be legitimate: /tmp on
  // macOS).
  if (!isAbsolute(args.flow)) {
    let walk = '';
    for (const part of flowSegments.filter(Boolean).slice(0, -1)) {
      walk = walk ? join(walk, part) : part;
      if (isSymlink(walk)) { eprint(`refusing to run: ${walk} is a symlink (ancestor of --flow)`); process.exit(2); }
    }
  }
  // Every later open/mkdir is bound to this resolved root (see assertInFlow):
  // create the flow dir when fresh (the preflight above refused a link at it
  // and, for a relative path, at every ancestor), then capture where it
  // really resolves.
  mkdirSync(args.flow, { recursive: true });
  flowRealRoot = realpathSync(args.flow);
  mkdirNoFollow(join(vdir, 'traces'));
  // _state.json is READ-ONLY here. The orchestrator owns it. Absent is fine
  // (a baseline-only run has no loop state yet), but present-and-unparsable
  // must not let the id-space gate below pass vacuously over a corrupt file.
  const statePath = join(args.flow, '_state.json');
  let st = {};
  // Read through the no-follow opener like every other flow-dir file; the
  // parse message is not echoed (it can quote the file's first bytes).
  const stateText = readIfPresent(statePath);
  if (stateText != null) {
    try { st = JSON.parse(stateText) || {}; }
    catch { eprint(`${statePath} exists but is not valid JSON - fix it before spending a pass`); process.exit(2); }
  }
  checkHarness(statePath, st, args.approveHarness);
  const ctx = { ...args, state: st };

  // Resume: which (id, rep) pairs already have a row?
  const resultsPath = join(vdir, 'results.jsonl');
  const done = new Set();
  for (const ln of (readIfPresent(resultsPath) ?? '').split('\n')) {
    if (!ln.trim()) continue;
    try { const r = JSON.parse(ln); done.add(`${r.prompt_id}\0${r.rep}`); } catch {}
  }
  // Rows key on the path-safe id (see pathSafeId), so resume must too.

  const cases = await loadCases();
  // Validate the id space before spending anything: duplicate path-safe ids - 
  // including case-insensitive twins, which macOS/Windows filesystems collapse - 
  // would silently overwrite traces and frozen refs; and a _state.json split id
  // that matches no case would silently shrink the scored denominator.
  const seen = new Map();
  for (const c of cases) {
    const k = pathSafeId(c.id).toLowerCase();
    if (seen.has(k)) {
      eprint(`duplicate case id after sanitization: '${c.id}' collides with '${seen.get(k)}'`);
      process.exit(2);
    }
    seen.set(k, c.id);
  }
  const safeIds = new Set(cases.map(c => pathSafeId(c.id)));
  for (const k of ['train_ids', 'val_ids', 'test_ids'])
    if (st[k] != null && !Array.isArray(st[k])) { eprint(`_state.json ${k} must be a list of ids`); process.exit(2); }
  for (const sid of [...(st.train_ids ?? []), ...(st.val_ids ?? []), ...(st.test_ids ?? [])]) {
    const s = String(sid); // the adapter joins with String() on both sides - numeric ids are fine
    if (safeIds.has(s)) continue; // matches a loaded case - definitionally valid
    if (s !== pathSafeId(s)) {
      // Can never match a row: rows key on path-safe ids. This is the silent
      // shrunken-denominator bug - fail before anything is spent.
      eprint(`_state.json split id '${s}' is not a path-safe id - record split ids exactly as they appear in results.jsonl's prompt_id`);
      process.exit(2);
    }
    // Well-formed but absent is legitimate (a trimmed top-K subset run) - note it, don't fail.
    eprint(`note: split id '${s}' matches no loaded case (expected for a trimmed subset run)`);
  }
  const refDir = join(args.flow, 'baseline', 'ref');
  const tasks = [];
  for (const c of cases) for (let rep = 0; rep < args.reps; rep++) {
    if (done.has(`${pathSafeId(c.id)}\0${rep}`)) continue;
    tasks.push({ c, rep });
  }
  eprint(`[${args.variant}] ${tasks.length} of ${cases.length * args.reps} (id,rep) to run`);

  let i = 0, ok = 0, fail = 0;
  const errorsPath = join(vdir, 'errors.jsonl');
  // A hard crash (power loss, ENOSPC) can leave a torn final line with no
  // trailing newline; the next append would merge two rows into one permanently
  // unparseable line. Isolate any fragment before appending anything.
  for (const p of [resultsPath, errorsPath]) {
    const tail = readIfPresent(p);
    if (tail && !tail.endsWith('\n')) appendFileNoFollow(p, '\n');
  }
  async function worker() {
    while (i < tasks.length) {
      const { c, rep } = tasks[i++];
      const safeId = pathSafeId(c.id);
      const t0 = Date.now();
      let lastRun = null;    // survives into the catch - billed spend on a failed attempt
      let rowWritten = false; // set once the results row lands - the attempt is scored
      const deadline = args.timeoutS > 0 ? t0 + args.timeoutS * 1000 : Infinity;
      const appRetry = { count: 0 }, judgeRetry = { count: 0 };
      try {
        // One ceiling over the whole case - app call, identity check, and grading - 
        // so a hung judge stream can't hold the slot either.
        const { run, g, latency_s } = await withTimeout((async () => {
          let tAttempt = t0;
          const run = await withBackoff(() => { tAttempt = Date.now(); return runCase(c, { ...ctx, rep }); },
            appRetry, deadline);
          lastRun = run;
          // latency_s = the final app attempt only; backoff sleeps, failed
          // attempts, and judge time are excluded (retry counts are in meta).
          const latency_s = (Date.now() - tAttempt) / 1000;
          // Serving identity: fail loudly when the response was served by a model
          // other than the one requested. Accept exact match or a documented
          // alias->snapshot resolution - 'foo-latest'/'foo-0'/'foo' served as
          // 'foo-20250101', 'foo@20250101', or 'foo-2025-01-01'. Anything else - 
          // another snapshot of the requested pin, a sibling model, or the bare
          // base id ('foo-latest' served as 'foo', an unversioned echo that can
          // hide snapshot drift across rounds) - fails the attempt. Non-Anthropic
          // id schemes (e.g. Bedrock's 'anthropic.claude-...-v1:0') need their own
          // rule here.
          if (ctx.model && run.model && run.model !== ctx.model) {
            const base = ctx.model.replace(/-latest$|-0$/, '');
            const rest = String(run.model).startsWith(base)
              ? String(run.model).slice(base.length) : null;
            if (!(rest != null && /^[-@](\d{8}|\d{4}-\d{2}-\d{2})$/.test(rest))) {
              const e = new Error(`served model ${run.model} != requested ${ctx.model}`);
              e.failure_class = 'serving_substitution';
              throw e;
            }
          }
          // Frozen pairwise reference (never regenerated): baseline/ref/<id>.*
          let ref = null;
          if (args.variant !== 'baseline') {
            const p = join(refDir, safeId);
            // A planted symlink throws (ELOOP) rather than feeding the judge
            // its target; the case then fails loudly instead of leaking.
            for (const ext of REF_EXTS) {
              try { ref = readFileNoFollow(p + ext); break; }
              catch (e) { if (e?.code !== 'ENOENT') throw e; }
            }
          }
          const g = await withBackoff(() => gradeCase(c, run, ref, { ...ctx, rep }), judgeRetry, deadline);
          return { run, g, latency_s };
        })(), args.timeoutS, `${c.id} rep${rep}`);
        const row = {
          prompt_id: safeId, rep, prompt: c.prompt ?? c.input ?? c.id,
          tags: c.tags, attachments: c.attachments,
          meta: safeId !== String(c.id) || appRetry.count || judgeRetry.count
            ? { ...(c.meta ?? {}),
                ...(safeId !== String(c.id) ? { original_id: String(c.id) } : {}),
                ...(appRetry.count ? { retries: appRetry.count } : {}),
                ...(judgeRetry.count ? { judge_retries: judgeRetry.count } : {}) }
            : c.meta,
          model: run.model, usage: run.usage, stop_reason: run.stop_reason,
          // The report keys on `status`, not stop_reason: a clipped answer is
          // counted and shown but kept out of the means. runCase may set
          // run.status to override the max_tokens rule.
          status: run.status ?? (run.stop_reason === 'max_tokens' ? 'truncated' : 'ok'),
          judge_model: g.judge_model ?? run.judge_model,
          judge_usage: g.judge_usage ?? run.judge_usage,
          latency_s, ...perfFrom(run),
          grade: g.grade, explanation: g.explanation,
        };
        appendFileNoFollow(resultsPath, JSON.stringify(row) + '\n');
        rowWritten = true; // past this point the attempt is scored - a later throw (trace write, ref freeze) must not also append an error row
        if (run.transcript)
          writeFileNoFollow(join(vdir, 'traces', `${safeId}_rep${rep}.json`),
            JSON.stringify(run.transcript, null, 2));
        // For pairwise: on the baseline run, freeze the reference output once.
        if (args.variant === 'baseline' && run.output != null
            && !REF_EXTS.some(ext => lexists(join(refDir, safeId) + ext))) {
          mkdirNoFollow(refDir);
          writeFileNoFollow(join(refDir, safeId),
            typeof run.output === 'string' ? run.output : JSON.stringify(run.output));
        }
        ok++;
      } catch (e) {
        fail++;
        if (rowWritten) {
          // The attempt scored; only a post-row write (trace, ref) failed. An error
          // row here would double-count the billed usage under the budget rule.
          eprint(`  [${args.variant}] ${c.id} rep${rep} scored, but a post-row write failed: ${e?.message || e}`);
          continue;
        }
        // Failed attempts are data too - but they must not occupy the (case, rep)
        // slot in results.jsonl, or resume would never re-run them.
        appendFileNoFollow(errorsPath, JSON.stringify({
          prompt_id: safeId, rep,
          ...(safeId !== String(c.id) ? { original_id: String(c.id) } : {}),
          failure_class: e?.failure_class ?? 'error',
          error: String(e?.message || e),
          retries: appRetry.count, judge_retries: judgeRetry.count,
          // Billed-but-failed spend stays countable: when the app call completed
          // before the failure (e.g. a served-model mismatch, a judge-stage
          // ceiling), carry its identity and usage on the error row.
          model: lastRun?.model ?? e?.model, usage: lastRun?.usage ?? e?.usage,
          judge_model: e?.judge_model ?? lastRun?.judge_model,
          judge_usage: e?.judge_usage ?? lastRun?.judge_usage,
          latency_s: (Date.now() - t0) / 1000,
        }) + '\n');
        eprint(`  [${args.variant}] ${c.id} rep${rep} FAILED: ${e?.message || e}`);
      }
    }
  }
  // One progress line every 30s (and to <vdir>/progress.txt) so "how far along
  // is it?" is answerable from the background shell's output or one file read,
  // without the orchestrator parsing results.jsonl mid-write. ETA is a plain
  // rate extrapolation from this pass.
  const t0 = Date.now();
  const progress = () => {
    const done = ok + fail, total = tasks.length;
    const el = (Date.now() - t0) / 1000;
    const eta = done ? Math.round((el / done) * (total - done)) : null;
    const line = `[${args.variant}] ${done}/${total} done (${ok} ok, ${fail} failed), `
      + `${Math.round(el)}s elapsed` + (eta != null ? `, ~${eta}s left` : '');
    eprint(line);
    try { writeFileNoFollow(join(vdir, 'progress.txt'), line + '\n'); } catch {}
  };
  const tick = setInterval(progress, 30_000);
  workersStarted = true;
  await Promise.all(Array.from({ length: Math.max(1, args.concurrency) }, worker));
  clearInterval(tick); progress();
  eprint(`[${args.variant}] done - ${ok} ok, ${fail} failed -> ${resultsPath}`);
  process.exit(fail ? 1 : 0);
}

// Anything main() throws prints as one sanitized line, not a raw stack. Before
// the workers start it is a refusal (a planted link at _state.json or
// results.jsonl, an lstat that fails, an error from loadCases) and exits 2 like
// the preflight refusals. After they start, only a failed errors.jsonl append
// gets here; rows may already be on disk, so say that and exit 1.
let workersStarted = false;
main().catch(e => {
  const m = String(e?.message || e);
  if (workersStarted) { eprint('stopped mid-run (rows already written are kept; re-run to resume): ' + m); process.exit(1); }
  eprint(m.startsWith('refusing to ') ? m : 'refusing to run: ' + m);
  process.exit(2);
});
