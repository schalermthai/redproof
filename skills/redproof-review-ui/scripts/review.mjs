import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const assets = resolve(dirname(fileURLToPath(import.meta.url)), '../assets');
const workActions = ['revise', 'experiment', 'implement'];
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const check = (condition, message) => { if (!condition) throw new Error(message); };
const text = (value, name, max = 30000) => check(typeof value === 'string' && value.trim().length > 0 && value.length <= max, `Invalid ${name}`);
const id = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(value);
const unique = values => new Set(values).size === values.length;
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const json = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

export function validateReview(review) {
  check(plain(review) && review.version === 1 && id(review.reviewId), 'Invalid review identity');
  check(['discovery', 'design', 'certification'].includes(review.stage) && typeof review.preview === 'boolean', 'Invalid review stage/preview');
  for (const key of ['title', 'background', 'recommendation', 'evidenceStatus', 'workArea', 'boundaries']) text(review[key], key);
  check(Array.isArray(review.gates) && review.gates.length > 0 && review.gates.length <= 30, 'Expected 1–30 Gates');
  check(unique(review.gates.map(g => g?.id)), 'Duplicate Gate IDs');
  for (const gate of review.gates) {
    check(plain(gate) && id(gate.id), 'Invalid Gate ID');
    for (const key of ['title', 'summary', 'example', 'evidence']) text(gate[key], key);
    if (review.stage !== 'certification' || gate.describe !== null) text(gate.describe, 'describe');
    if (review.stage === 'certification') {
      const c = gate.certification;
      check(plain(c), 'Missing certification results');
      check(['implemented-and-verified', 'partially-implemented', 'blocked'].includes(c.status), 'Invalid implementation status');
      check(['trusted', 'not-trusted'].includes(c.decision), 'Invalid trust decision');
      check((c.status === 'implemented-and-verified') === (c.decision === 'trusted'), 'Contradictory trust/status');
      if (c.status === 'implemented-and-verified') text(gate.describe, 'verified implementation describe');
      for (const key of ['designReference', 'actualDescribeSource', 'verification', 'insights', 'improvements', 'nextStep']) text(c[key], key);
      if (c.reader !== undefined) {
        check(plain(c.reader), 'Invalid reader summary');
        for (const key of ['planned', 'delivered', 'evidence', 'limitation', 'change', 'insight', 'improvement', 'nextStep']) text(c.reader[key], `reader ${key}`, 900);
      }
      if (c.designDescribe !== null) text(c.designDescribe, 'design describe');
      check(Array.isArray(c.comparison) && c.comparison.length > 0 && c.comparison.length <= 60, 'Invalid design comparison');
      for (const row of c.comparison) {
        check(plain(row), 'Invalid comparison row');
        for (const key of ['promise', 'planned', 'actual']) text(row[key], key);
        check(['delivered', 'changed', 'deferred', 'blocked'].includes(row.disposition), 'Invalid comparison disposition');
      }
    } else check(gate.certification === undefined, 'Results require certification stage');
    if (gate.details !== undefined) text(gate.details, 'details', 100000);
    const allowed = review.stage === 'discovery' ? ['design', 'later', 'skip']
      : review.stage === 'certification' ? ['investigate', 'revise', 'implement', 'later', 'skip'] : [...workActions, 'later', 'skip'];
    check(Array.isArray(gate.actions) && gate.actions.length >= 2 && unique(gate.actions.map(a => a?.id)), 'Invalid actions');
    for (const action of gate.actions) {
      check(plain(action) && allowed.includes(action.id), 'Unsupported action');
      text(action.label, 'action label', 200); text(action.description, 'action description');
      check(action.recommended === undefined || typeof action.recommended === 'boolean', 'Invalid recommendation');
    }
    check(['later', 'skip'].every(a => gate.actions.some(b => b.id === a)), 'Offer Later and Skip');
    if (review.stage === 'design') {
      check(Array.isArray(gate.scopes) && gate.scopes.length > 0 && gate.scopes.length <= 8 && unique(gate.scopes.map(s => s?.id)), 'Invalid scopes');
      for (const scope of gate.scopes) {
        check(plain(scope) && id(scope.id), 'Invalid scope ID');
        for (const key of ['label', 'description', 'describe']) text(scope[key], key);
        check(scope.recommended === undefined || typeof scope.recommended === 'boolean', 'Invalid scope recommendation');
        check(Array.isArray(scope.actions) && scope.actions.length > 0 && unique(scope.actions) && scope.actions.every(a => workActions.includes(a) && gate.actions.some(b => b.id === a)), 'Invalid scope actions');
      }
    } else check(gate.scopes === undefined, 'Only design offers scope choices');
  }
  return review;
}

export const digestOf = review => createHash('sha256').update(JSON.stringify(review)).digest('hex');

export function validateAnswer(review, answer) {
  check(plain(answer) && Object.keys(answer).sort().join(',') === 'decisions,reviewDigest,reviewId,status,version', 'Unexpected answer fields');
  check(answer.version === 1 && answer.reviewId === review.reviewId && answer.reviewDigest === digestOf(review), 'Stale or mismatched review');
  check(['submitted', 'cancelled'].includes(answer.status) && Array.isArray(answer.decisions), 'Invalid response status');
  if (answer.status === 'cancelled') {
    check(answer.decisions.length === 0, 'Cancellation cannot authorize choices');
    return answer;
  }
  check(answer.decisions.length === review.gates.length && unique(answer.decisions.map(d => d?.gateId)), 'Missing or duplicate Gate decisions');
  for (const decision of answer.decisions) {
    check(plain(decision) && Object.keys(decision).sort().join(',') === 'action,gateId,note,scope', 'Unexpected decision fields');
    const gate = review.gates.find(g => g.id === decision.gateId);
    check(gate && typeof decision.note === 'string' && decision.note.length <= 4000, 'Unknown Gate or invalid note');
    check(decision.action === null || gate.actions.some(a => a.id === decision.action), 'Unoffered action');
    const scope = gate.scopes?.find(s => s.id === decision.scope);
    if (review.stage === 'design' && workActions.includes(decision.action)) {
      check(scope?.actions.includes(decision.action), 'Choose an available scope and depth');
    } else check(decision.scope === null || (review.stage === 'design' && scope), 'Unoffered scope');
  }
  return answer;
}

export async function renderReview(review, token = '') {
  validateReview(review);
  const client = await readFile(join(assets, 'review.js'), 'utf8');
  const css = await readFile(join(assets, 'review.css'), 'utf8');
  const hash = createHash('sha256').update(client).digest('base64');
  const csp = `default-src 'none'; script-src 'sha256-${hash}'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
  const option = (gate, choice, kind) => `<label class="option"><input type="radio" name="${kind}-${gate.id}" value="${choice.id}" data-kind="${kind}"><span><strong>${escape(choice.label)}</strong>${choice.recommended ? '<span class="badge">Recommended</span>' : ''}<span class="explain">${escape(choice.description)}</span></span></label>`;
  const isResults = review.stage === 'certification';
  const state = gate => ({ 'implemented-and-verified': ['verified', 'Verified in this scope'], 'partially-implemented': ['partial', 'Partly delivered'], blocked: ['blocked', 'Blocked'] })[gate.certification.status];
  const statusLabel = gate => { const [kind, label] = state(gate); return `<span class="result-status ${kind}">${label}</span>`; };
  const results = gate => {
    const c = gate.certification;
    const r = c.reader;
    const block = value => value === null ? '<p class="muted">Not available — no describe block claimed.</p>' : `<pre tabindex="0"><code>${escape(value)}</code></pre>`;
    const main = `<div class="results">
      ${r ? `<div class="delivery-pair"><div><span class="small-label">The plan</span><p>${escape(r.planned)}</p></div><div><span class="small-label">What you have now</span><p>${escape(r.delivered)}</p></div></div>
      <div class="confidence"><h3>How we checked it</h3><p>${escape(r.evidence)}</p><p class="scope-limit"><strong>The limit:</strong> ${escape(r.limitation)}</p></div>
      <p class="plan-change"><strong>Changed from the plan:</strong> ${escape(r.change)}</p>` : `<p>${escape(gate.evidence)}</p><p>${escape(c.nextStep)}</p>`}
      ${r ? `<p class="next-advice"><strong>Our recommendation</strong><br>${escape(r.nextStep)}</p>` : ''}</div>`;
    const detail = `${r ? `<div class="learning-grid"><div><h3>What we learned</h3><p>${escape(r.insight)}</p></div><div><h3>What we improved</h3><p>${escape(r.improvement)}</p></div></div>` : ''}
      <details class="technical-record"><summary>See checks, evidence &amp; design <span>Technical record</span></summary>
      <p>${c.decision === 'trusted' ? 'TRUSTED for the recorded scope only.' : 'NOT TRUSTED for the full recorded scope.'} This result is not approval to adopt or deploy the Gate.</p>
      <p>${escape(gate.evidence)}</p>
      <div class="example"><strong>For example</strong><p>${escape(gate.example)}</p></div>
      <h3>Verification and limits</h3><p class="result-text">${escape(c.verification)}</p>
      <h3>Design versus actual</h3><p>${escape(c.designReference)}</p>
      <div class="comparison-scroll" tabindex="0" role="region" aria-label="Design versus actual comparison"><table><thead><tr><th>Promise or component</th><th>Approved design</th><th>Actual delivery and evidence</th><th>Disposition</th></tr></thead><tbody>${c.comparison.map(row => `<tr>${['promise', 'planned', 'actual', 'disposition'].map(key => `<td>${escape(row[key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      ${c.decision !== 'trusted' ? `<p class="scope-limit"><strong>Partial delivery, not a verified full Gate.</strong> ${escape(r?.delivered ?? c.actualDescribeSource)}</p>` : ''}
      <div class="describe-pair"><div><h3>Selected design · describe</h3>${block(c.designDescribe)}</div><div><h3>${c.decision === 'trusted' ? 'Delivered implementation' : 'Partial implementation'} · describe</h3>${block(gate.describe)}</div></div>
      <p class="muted describe-source"><strong>Description source:</strong> ${escape(c.actualDescribeSource)}</p>
      ${[['Learning record', c.insights], ['Improvement record', c.improvements], ['Next-step scope and prerequisites', c.nextStep]].map(([label, value]) => `<h3>${label}</h3><p class="result-text">${escape(value)}</p>`).join('')}
      ${gate.details ? `<h3>Supporting detail</h3><div class="detail">${escape(gate.details)}</div>` : ''}</details>`;
    return {main, detail};
  };
  const cards = review.gates.map(gate => { const content = isResults ? results(gate) : null; return `<section class="gate" id="gate-${gate.id}" data-gate="${gate.id}" aria-labelledby="title-${gate.id}">
    ${isResults ? statusLabel(gate) : ''}<h2 id="title-${gate.id}">${escape(gate.title)}</h2><p>${escape(gate.summary)}</p>
    ${isResults ? content.main : `<div class="example"><strong>For example</strong><p>${escape(gate.example)}</p></div><p class="muted">${escape(gate.evidence)}</p>`}
    ${review.stage === 'design' ? `<fieldset><legend>1. What should this cover?</legend>${gate.scopes.map(s => option(gate, s, 'scope')).join('')}</fieldset>` : ''}
    ${isResults ? '' : `<div class="proposed-describe"><h3>${review.stage === 'discovery' ? 'Draft' : 'Proposed'} describe · not an executed Gate</h3><pre tabindex="0"><code data-describe>${escape(gate.describe)}</code></pre></div>`}
    <fieldset id="next-${gate.id}"><legend>${review.stage === 'discovery' ? 'What would you like to do?' : isResults ? 'What would you like to do next?' : '2. How far should we take it?'}</legend>${gate.actions.map(a => option(gate, a, 'action')).join('')}</fieldset>
    <p class="availability" aria-live="polite"></p><label class="note-label" for="note-${gate.id}">${isResults ? 'A question or something to change?' : 'Anything to change?'} <span class="muted">Optional</span></label><textarea id="note-${gate.id}" maxlength="4000" rows="2" placeholder="${isResults ? 'Add a question, a source link, or a preference.' : 'For example: start with the smaller scope.'}"></textarea>
    <button class="link-button clear" type="button">Clear this choice</button>
    ${isResults ? content.detail : ''}
    ${gate.details && !isResults ? `<details><summary>Evidence and design detail</summary><div class="detail">${escape(gate.details)}</div></details>` : ''}
    </section>`; }).join('');
  const firstNext = review.gates.find(g => g.certification?.status !== 'implemented-and-verified') ?? review.gates[0];
  const resultsIntro = isResults ? `<header class="results-intro"><p class="eyebrow">Redproof / Results</p><h1>${escape(review.title)}</h1><p class="lead">${escape(review.background)}</p><p class="report-basis">${escape(review.evidenceStatus)}</p>
    <p class="preview-note">${review.preview ? '<strong>Preview only.</strong> Choices here will not start work.' : 'Reading this report starts no work. You will review your choices before sending them.'}</p></header>
    <aside class="next-callout"><div><span class="small-label">Recommended next step</span><p>${escape(review.recommendation)}</p></div><a class="action-link" href="#next-${firstNext.id}">Review next steps <span aria-hidden="true">→</span></a></aside>
    <section class="delivery-overview" aria-label="Results at a glance">${review.gates.map(g => `<a class="overview-item" href="#gate-${g.id}">${statusLabel(g)}<h2>${escape(g.title)}</h2><p>${escape(g.summary)}</p><span class="overview-link">See the result <span aria-hidden="true">↗</span></span></a>`).join('')}</section>` : '';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${escape(csp.replace('; frame-ancestors \'none\'', ''))}"><title>${escape(review.title)}</title><style>${css}</style></head><body${isResults ? ' class="certification"' : ''}><main>
    ${isResults ? resultsIntro : `
    <p class="eyebrow">Redproof · ${review.stage === 'discovery' ? 'Choose what matters' : 'Choose the next step'}</p><h1>${escape(review.title)}</h1><p class="lead">${escape(review.background)}</p>
    ${review.preview ? '<p class="preview-note"><strong>Preview only.</strong> Choices here will not start work.</p>' : '<p class="preview-note">Nothing is selected yet. You will review your choices before sending them.</p>'}
    <div class="recommendation"><strong>My recommendation</strong><p>${escape(review.recommendation)}</p></div><p>${escape(review.evidenceStatus)}</p>
    <p class="terms">A <strong>Gate</strong> checks a promise. A <strong>proof</strong> tests its response to a controlled failure, allowed behavior or unusable evidence. <strong>REFUSE</strong> means the evidence cannot be trusted enough to decide.</p>
    <p class="stage-purpose">${review.stage === 'discovery' ? 'Choose which promises deserve a detailed design. This step does not build or run a Gate.' : 'Choose coverage, then the work to carry out. Implementation choices finish with results or a clear blocker; design-only choices stop at an updated proposal.'}</p>
    <details class="report-boundaries"><summary>Work location &amp; permissions</summary><p><strong>Where work can happen:</strong> ${escape(review.workArea)}</p><p><strong>Not included:</strong> ${escape(review.boundaries)}</p></details>
    <nav class="gate-index" aria-label="Gate proposals"><strong>Explore the proposals</strong>${review.gates.map(g => `<a href="#gate-${g.id}">${escape(g.title)}</a>`).join('')}</nav>`}
    ${cards}
    ${isResults ? `<details class="report-boundaries"><summary>About this report &amp; work permissions</summary><p>A Gate checks a promise. A proof tests its response to a controlled failure, allowed behavior or unusable evidence. REFUSE means the evidence cannot support a trustworthy decision.</p><p><strong>Where:</strong> ${escape(review.workArea)}</p><p><strong>Not included:</strong> ${escape(review.boundaries)}</p></details>` : ''}
    <section id="confirmation" hidden tabindex="-1"><h2>Check your choices</h2><div id="choices"></div><p id="confirm-boundary"></p><button id="confirm" type="button">Confirm choices</button><button id="edit" class="secondary" type="button">Keep editing</button></section>
    <section id="fallback" hidden><h2>Your choices are ready, but were not sent</h2><p>The local collector is unavailable. Paste this short summary into the conversation instead, or answer there in your own words.</p><textarea id="digest" readonly rows="9" aria-label="Choices to return in chat"></textarea><button id="copy" type="button">Copy choices</button><p id="copy-status" aria-live="polite"></p></section>
    <footer><p id="status" role="status" aria-live="polite">Choose any Gates you care about. Unanswered Gates stay undecided.</p><button id="review" type="button">Review my choices</button><button id="cancel" class="secondary" type="button">Not now</button></footer>
    <noscript>This page needs JavaScript to send choices. You can read the proposals and tell the agent your choices in chat instead.</noscript>
    </main><script type="application/json" id="review-data">${json({ review, digest: digestOf(review), token })}</script><script>${client}</script></body></html>`;
  return { html, csp };
}

export async function startReview(input, outDir, { timeoutMs = 1800000, renderOnly = false } = {}) {
  // Snapshot caller input before awaiting; later edits must never alter offered choices.
  const review = validateReview(JSON.parse(JSON.stringify(input)));
  check(Number.isFinite(timeoutMs) && timeoutMs > 0 && timeoutMs <= 86400000, 'Invalid timeout');
  await mkdir(outDir, { recursive: true });
  const answerPath = join(outDir, 'review.answers.json');
  // Exclusive files make a second round use a new directory instead of stale approval.
  await writeFile(join(outDir, 'review.snapshot.json'), JSON.stringify(review, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  const offline = await renderReview(review);
  await writeFile(join(outDir, 'review.html'), offline.html, { flag: 'wx', mode: 0o600 });
  if (renderOnly) return { htmlPath: join(outDir, 'review.html') };
  const token = randomBytes(32).toString('hex');
  const page = await renderReview(review, token);
  let origin, finished = false, accepting = false, timer, finish;
  const done = new Promise(resolveDone => { finish = resolveDone; });
  const end = status => {
    if (finished) return;
    finished = true; clearTimeout(timer);
    server.close(); server.closeAllConnections(); finish(status);
  };
  const server = createServer(async (req, res) => {
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': page.csp });
      res.end(body);
    };
    if (req.headers.host !== new URL(origin).host) return send(403, '{"error":"Invalid host"}');
    if (req.method === 'GET' && req.url === '/') return send(200, page.html, 'text/html; charset=utf-8');
    if (req.method !== 'POST' || req.url !== '/answers') return send(404, '{"error":"Not found"}');
    if (req.headers.origin !== origin || req.headers['x-review-token'] !== token) return send(403, '{"error":"Invalid session"}');
    if (req.headers['content-type'] !== 'application/json') return send(415, '{"error":"Expected JSON"}');
    if (finished || accepting) return send(409, '{"error":"Review already answered"}');
    const length = Number(req.headers['content-length']);
    if (!Number.isInteger(length) || length < 1 || length > 262144) return send(413, '{"error":"Invalid body size"}');
    try {
      let size = 0; const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 262144) { send(413, '{"error":"Body too large"}'); return; }
        chunks.push(chunk);
      }
      check(size === length, 'Incomplete request');
      const answer = validateAnswer(review, JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if (finished || accepting) return send(409, '{"error":"Review already answered"}');
      accepting = true;
      clearTimeout(timer);
      const record = { ...answer, receivedAt: new Date().toISOString() };
      try { await writeFile(answerPath, JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
      catch { send(500, '{"error":"Could not save; no new decision accepted"}'); end('error'); return; }
      // Close after the response is flushed, not while the browser is reading it.
      res.once('finish', () => end(answer.status));
      res.once('close', () => end(answer.status));
      if (res.destroyed) { end(answer.status); return; }
      send(200, '{"ok":true}');
    } catch (error) {
      if (!res.headersSent && !res.destroyed) send(400, JSON.stringify({ error: error.message }));
    }
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000;
  server.on('connection', socket => socket.setTimeout(10000, () => socket.destroy()));
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', () => { origin = `http://127.0.0.1:${server.address().port}`; resolveListen(); });
  });
  timer = setTimeout(() => end('timeout'), timeoutMs);
  return { url: origin + '/', answerPath, done, close: () => end('cancelled') };
}

async function main(args) {
  const input = args[0], outIndex = args.indexOf('--out'), timeoutIndex = args.indexOf('--timeout');
  check(input && outIndex >= 1 && args[outIndex + 1], 'Usage: node review.mjs review.json --out fresh-directory [--timeout seconds] [--render-only]');
  const review = JSON.parse(await readFile(resolve(input), 'utf8'));
  const result = await startReview(review, resolve(args[outIndex + 1]), { renderOnly: args.includes('--render-only'), timeoutMs: timeoutIndex < 0 ? 1800000 : Number(args[timeoutIndex + 1]) * 1000 });
  if (result.htmlPath) { console.log(`HTML: ${result.htmlPath}`); return; }
  console.log(`URL: ${result.url}\nANSWERS: ${result.answerPath}\nEXPIRES: bounded local session; no response grants no authority.`);
  const interrupt = () => result.close();
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  const status = await result.done;
  process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
  console.log(`REVIEW: ${status}`);
  process.exitCode = { submitted: 0, cancelled: 2, timeout: 3, error: 1 }[status];
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
