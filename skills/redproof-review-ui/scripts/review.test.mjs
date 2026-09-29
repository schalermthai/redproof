import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { digestOf, renderReview, startReview, validateAnswer, validateReview } from './review.mjs';
import { certificationFixture } from './fixtures/certification.mjs';

test('certification requires honest status, comparisons and describe availability', async () => {
  const review = certificationFixture();
  validateReview(review);
  for (const edit of [
    r => { r.gates[1].certification.decision = 'trusted'; },
    r => { r.gates[0].describe = null; },
    r => { r.gates[0].certification.comparison = []; },
    r => { r.gates[0].certification.comparison[0].disposition = 'approved'; },
    r => { delete r.gates[1].certification.designDescribe; },
    r => { r.gates[0].actions[0].id = 'adopt'; },
    r => { r.gates[0].scopes = []; },
  ]) { const candidate = structuredClone(review); edit(candidate); assert.throws(() => validateReview(candidate)); }
  review.gates[0].certification.insights = '</script><img src=x onerror=alert(1)>';
  const {html} = await renderReview(review);
  assert.ok(!html.includes(review.gates[0].certification.insights));
  assert.ok(html.includes('Selected design · describe'));
  assert.ok(html.includes('No Gate implementation exists.'));
  assert.ok(!html.includes('Proposed describe · not an executed Gate'));
  assert.equal((html.match(/<input[^>]*\schecked(?:\s|>)/g) ?? []).length, 0);
});

test('certification follow-up preserves results and cannot rewrite trust or expand scope', async t => {
  const review = certificationFixture(), before = structuredClone(review);
  const {server, dir, post} = await serve(t, review);
  const response = {version:1,reviewId:review.reviewId,reviewDigest:digestOf(review),status:'submitted',decisions:[
    {gateId:'requests',action:'implement',scope:null,note:'Only the diagnostic; keep the promise unchanged.'},
    {gateId:'lint',action:null,scope:null,note:'I will supply the source later.'},
  ]};
  for (const edit of [
    a => { a.decisions[0].decision = 'trusted'; },
    a => { a.decisions[0].action = 'adopt'; },
    a => { a.decisions[0].scope = 'all-project'; },
  ]) { const candidate = structuredClone(response); edit(candidate); assert.throws(() => validateAnswer(review, candidate)); }
  assert.equal((await post(response)).status,200);
  assert.equal(await server.done,'submitted');
  assert.deepEqual(JSON.parse(await readFile(server.answerPath,'utf8')).decisions,response.decisions);
  assert.deepEqual(JSON.parse(await readFile(join(dir,'review.snapshot.json'),'utf8')),before);
});

test('reader summaries preserve the full record without making unsupported choices or hiding status', async () => {
  const review = certificationFixture();
  const gate = review.gates[0];
  gate.certification.reader = Object.fromEntries(['planned','delivered','evidence','limitation','change','insight','improvement','nextStep'].map(key => [key, `Short ${key} summary.`]));
  const saved = structuredClone(review);
  const {html} = await renderReview(review);
  assert.deepEqual(review,saved);
  assert.ok(html.includes(gate.certification.verification));
  assert.ok(html.includes(gate.certification.designReference));
  assert.ok(html.includes(gate.describe));
  assert.ok(html.includes(gate.certification.reader.limitation));
  assert.ok(html.includes('href="#next-lint"'));
  assert.equal((html.match(/class="technical-record"[^>]*\bopen\b/g) ?? []).length,0);
  for (const value of [null, [], {}, {...gate.certification.reader, limitation:''}, {...gate.certification.reader, evidence:'x'.repeat(901)}]) {
    const invalid = structuredClone(review); invalid.gates[0].certification.reader=value;
    assert.throws(()=>validateReview(invalid));
  }
  gate.certification.reader.insight = '</script><img src=x onerror=alert(1)>';
  const hostile = await renderReview(review);
  assert.ok(!hostile.html.includes(gate.certification.reader.insight));
  assert.ok(hostile.html.includes('&lt;img'));
});

export function fixture(stage = 'design') {
  const describe = 'Gate: boundary\n\nRules:\n  R1 Invalid requests stop before the observed connection hook.\n\nCheck:\n  Run selected request cases.';
  const actions = stage === 'design'
    ? [
      { id: 'implement', label: 'Implement and prove this Gate', description: 'Build the settled Gate, Check and proofs in the safe copy. Run the real project and report verified results or a blocker; no CI.', recommended: true },
      { id: 'revise', label: 'Refine the design', description: 'No execution.' },
      { id: 'experiment', label: 'Run a feasibility experiment first', description: 'Determine whether the connection hook exposes failed attempts in a disposable copy; report that answer and stop. No verified Gate promised.' },
    ]
    : [{ id: 'design', label: 'Design this Gate', description: 'Design only.', recommended: true }];
  actions.push({ id: 'later', label: 'Later', description: 'No work now.' }, { id: 'skip', label: 'Skip', description: 'Do not pursue.' });
  const gate = { id: 'boundary', title: 'Keep requests valid', summary: 'Protect downstream callers.', example: 'Reject malformed text before a connection attempt.', evidence: 'Source inspected; no execution.', describe, actions };
  if (stage === 'design') gate.scopes = [
    { id: 'focused', label: 'Observed connection boundary', description: 'Selected request cases, no delivery claim.', describe, actions: ['revise', 'experiment', 'implement'], recommended: true },
    { id: 'broader', label: 'Include successful delivery', description: 'Needs a new evidence design first.', describe: describe.replace('selected request cases', 'evidence investigation for delivery'), actions: ['revise'] },
  ];
  return { version: 1, reviewId: `test-${stage}`, stage, preview: true, title: 'Choose protection', background: 'A test-only review.', recommendation: 'Start small.', evidenceStatus: 'No execution.', workArea: 'Task-owned disposable copy.', boundaries: 'No CI, network or publication.', gates: [gate, { ...structuredClone(gate), id: 'second', title: 'Another promise' }] };
}

const answer = review => ({ version: 1, reviewId: review.reviewId, reviewDigest: digestOf(review), status: 'submitted', decisions: review.gates.map((g, index) => ({ gateId: g.id, action: index ? null : review.stage === 'design' ? 'experiment' : 'design', scope: index || review.stage === 'discovery' ? null : 'focused', note: index ? 'Please explain this later' : 'Only synthetic data' })) });

test('proposals expose their describe before work choices and distinguish the next stage', async () => {
  for (const stage of ['discovery', 'design']) {
    const review = fixture(stage);
    review.gates[0].details = 'Supporting evidence.';
    const before = structuredClone(review);
    const {html} = await renderReview(review);
    const card = html.slice(html.indexOf('id="gate-boundary"'), html.indexOf('id="gate-second"'));
    assert.ok(card.indexOf('data-describe') < card.indexOf('id="next-boundary"'));
    assert.ok(card.indexOf('data-describe') < card.indexOf('<details'));
    assert.equal((html.match(/<input[^>]*\schecked(?:\s|>)/g) ?? []).length, 0);
    assert.ok(html.includes('aria-label="Gate proposals"'));
    assert.ok(html.includes(stage === 'discovery' ? 'This step does not build or run a Gate.' : 'Implementation choices finish with results or a clear blocker'));
    assert.deepEqual(review, before);
  }
});

test('preserves mixed decisions, notes and unanswered entries', () => {
  for (const stage of ['design', 'discovery']) {
    const review = validateReview(fixture(stage)), response = answer(review);
    assert.deepEqual(validateAnswer(review, response), response);
    assert.equal(response.decisions[1].action, null);
  }
  const review = fixture(), incomplete = answer(review);
  incomplete.decisions[0].action = null;
  assert.equal(validateAnswer(review, incomplete).decisions[0].scope, 'focused');
});

test('rejects stale identity, unknown/duplicate choices and unsupported depth', () => {
  const review = fixture();
  const edits = [
    a => { a.reviewDigest = 'old'; }, a => { a.reviewId = 'old'; },
    a => { a.decisions[0].action = 'adopt'; }, a => { a.decisions[0].scope = 'unknown'; },
    a => { a.decisions[0].scope = 'broader'; }, a => { a.decisions[1].gateId = 'boundary'; },
    a => { a.decisions[0].gateId = 'unknown'; }, a => { a.decisions.pop(); },
    a => { a.decisions[0].note = 'x'.repeat(4001); }, a => { a.decisions[0].command = 'do something'; },
    a => { a.decisions[0].scope = null; }, a => { a.status = 'cancelled'; },
  ];
  for (const edit of edits) { const a = answer(review); edit(a); assert.throws(() => validateAnswer(review, a)); }
});

test('requires distinct review choices and separates discovery from execution', () => {
  const review = fixture('discovery');
  review.gates[0].actions[0].id = 'implement';
  assert.throws(() => validateReview(review));
  const duplicate = fixture(); duplicate.gates[1].id = duplicate.gates[0].id;
  assert.throws(() => validateReview(duplicate));
});

test('escapes repository data and never preselects recommendations', async () => {
  const review = fixture();
  const hostile = '</script><img src=x onerror=alert(1)>';
  review.title = hostile; review.gates[0].actions[0].label = hostile;
  const { html } = await renderReview(review);
  assert.ok(!html.includes(hostile));
  assert.match(html, /&lt;img/);
  assert.equal((html.match(/<input[^>]*\schecked(?:\s|>)/g) ?? []).length, 0);
  assert.ok(html.includes('Preview only.'));
});

async function serve(t, review = fixture(), options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'redproof-review-test-'));
  const server = await startReview(review, dir, { timeoutMs: 5000, ...options });
  t.after(() => server.close());
  const page = await (await fetch(server.url)).text();
  const config = JSON.parse(page.match(/id="review-data">([\s\S]*?)<\/script>/)[1]);
  const headers = { Origin: new URL(server.url).origin, 'Content-Type': 'application/json', 'X-Review-Token': config.token };
  const post = (body, extra = {}) => fetch(new URL('answers', server.url), { method: 'POST', headers: { ...headers, ...extra }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { dir, server, config, post };
}

test('collector validates origin, token, schema, size and only serves its page', async t => {
  const review = fixture(), { server, post } = await serve(t, review);
  assert.equal((await fetch(new URL('review.snapshot.json', server.url))).status, 404);
  const wrongHost = await new Promise((resolveStatus, reject) => {
    const req = request(server.url, { headers: { Host: 'attacker.example' } }, res => { res.resume(); resolveStatus(res.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(wrongHost, 403);
  assert.equal((await post(answer(review), { Origin: 'https://attacker.example' })).status, 403);
  assert.equal((await post(answer(review), { 'X-Review-Token': 'wrong' })).status, 403);
  assert.equal((await post(answer(review), { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post('{')).status, 400);
  assert.equal((await post({ ...answer(review), reviewDigest: 'old' })).status, 400);
  assert.equal((await post('x'.repeat(262145))).status, 413);
  const response = await post(answer(review));
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true });
  assert.equal(await server.done, 'submitted');
  const saved = JSON.parse(await readFile(server.answerPath, 'utf8'));
  assert.deepEqual(saved.decisions, answer(review).decisions);
  assert.equal(saved.reviewDigest, digestOf(review));
});

test('accepts at most one racing submission without overwriting', async t => {
  const review = fixture(), { server, post } = await serve(t, review);
  const competing = answer(review); competing.decisions[0].note = 'competing';
  const responses = await Promise.allSettled([post(answer(review)), post(competing)]);
  assert.equal(responses.filter(r => r.status === 'fulfilled' && r.value.status === 200).length, 1);
  assert.equal(await server.done, 'submitted');
  const saved = JSON.parse(await readFile(server.answerPath, 'utf8'));
  assert.ok(['competing', 'Only synthetic data'].includes(saved.decisions[0].note));
});

test('keeps implementation and experiment finish lines distinct in the same safe copy', async t => {
  const review = fixture();
  review.evidenceStatus = 'Contract settled; the real runner dependency is not cached. No installation authority.';
  const { server, dir, post } = await serve(t, review);
  const response = answer(review);
  response.decisions[0] = { gateId: 'boundary', action: 'implement', scope: 'focused', note: 'Report a blocker if the real runner is unavailable.' };
  response.decisions[1] = { gateId: 'second', action: 'experiment', scope: 'focused', note: 'Only investigate the hook.' };
  assert.equal((await post(response)).status, 200);
  assert.equal(await server.done, 'submitted');
  const saved = JSON.parse(await readFile(server.answerPath, 'utf8'));
  const snapshot = JSON.parse(await readFile(join(dir, 'review.snapshot.json'), 'utf8'));
  assert.deepEqual(saved.decisions, response.decisions);
  assert.equal(saved.reviewDigest, digestOf(snapshot));
  assert.deepEqual(snapshot, review);
  // Neither the shared location nor unmet tooling prerequisites rewrite the action.
  assert.equal(saved.decisions[0].action, 'implement');
  assert.equal(saved.decisions[1].action, 'experiment');
  const unsupported = structuredClone(response);
  unsupported.decisions[0].scope = 'broader';
  assert.throws(() => validateAnswer(snapshot, unsupported));
});

test('cancel and timeout authorize nothing; answer files cannot be overwritten', async t => {
  const review = fixture(), { server, post } = await serve(t, review);
  assert.equal((await post({ ...answer(review), status: 'cancelled', decisions: [] })).status, 200);
  assert.equal(await server.done, 'cancelled');
  assert.deepEqual(JSON.parse(await readFile(server.answerPath, 'utf8')).decisions, []);
  const expired = await serve(t, fixture(), { timeoutMs: 150 });
  assert.equal(await expired.server.done, 'timeout');
  await assert.rejects(readFile(expired.server.answerPath), { code: 'ENOENT' });
  const stale = await serve(t);
  await writeFile(stale.server.answerPath, 'previous decision', { flag: 'wx' });
  assert.equal((await stale.post(answer(review))).status, 500);
  assert.equal(await stale.server.done, 'error');
  assert.equal(await readFile(stale.server.answerPath, 'utf8'), 'previous decision');
});

test('snapshot is immutable and review directories cannot be reused', async t => {
  const original = fixture(), before = structuredClone(original);
  const { server, dir, post } = await serve(t, original);
  original.gates[0].actions[0].description = 'silently changed';
  assert.equal((await post(answer(before))).status, 200);
  assert.equal(await server.done, 'submitted');
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'review.snapshot.json'), 'utf8')), before);
  await assert.rejects(startReview(original, dir), { code: 'EEXIST' });
});
