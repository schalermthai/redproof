'use strict';
(() => {
  const { review, digest, token } = JSON.parse(document.getElementById('review-data').textContent);
  const $ = id => document.getElementById(id);
  const cards = [...document.querySelectorAll('[data-gate]')];
  const work = ['revise', 'experiment', 'implement'];
  let pending = null, busy = false;

  function collect() {
    return review.gates.map((gate, index) => {
      const card = cards[index];
      const action = card.querySelector('[data-kind="action"]:checked')?.value ?? null;
      const scope = card.querySelector('[data-kind="scope"]:checked')?.value ?? null;
      return { gateId: gate.id, action, scope, note: card.querySelector('textarea').value.trim() };
    });
  }
  function update() {
    pending = null; $('confirmation').hidden = true;
    for (const [index, gate] of review.gates.entries()) {
      const card = cards[index];
      const scope = gate.scopes?.find(s => s.id === card.querySelector('[data-kind="scope"]:checked')?.value);
      const describe = card.querySelector('[data-describe]');
      if (describe) describe.textContent = scope?.describe ?? gate.describe;
      for (const input of card.querySelectorAll('[data-kind="action"]')) {
        input.disabled = review.stage === 'design' && work.includes(input.value) && !scope?.actions.includes(input.value);
        if (input.disabled) input.checked = false;
      }
      card.querySelector('.availability').textContent = review.stage === 'design'
        ? (scope ? 'Available work depends on this scope. Dimmed choices need more design first.' : 'Choose the coverage above to see which next steps are available.') : '';
    }
    const answered = collect().filter(d => d.action !== null).length;
    $('status').textContent = `${answered} of ${review.gates.length} Gates chosen. Unanswered Gates stay undecided.`;
  }
  function summary(decisions, detail = false) {
    return decisions.map(d => {
      const gate = review.gates.find(g => g.id === d.gateId);
      const action = gate.actions.find(a => a.id === d.action);
      const scope = gate.scopes?.find(s => s.id === d.scope);
      return `${gate.title}: ${action?.label ?? 'Unanswered — no work authorized'}${scope ? ` · ${scope.label}` : ''}${detail && action ? `\n${action.description}` : ''}${detail && scope ? `\nCoverage: ${scope.description}` : ''}${d.note ? `\nNote: ${d.note}` : ''}`;
    });
  }
  function payload(status) {
    return { version: 1, reviewId: review.reviewId, reviewDigest: digest, status, decisions: status === 'cancelled' ? [] : collect() };
  }
  function fallback(answer) {
    $('fallback').hidden = false;
    $('digest').value = `${review.preview ? 'PREVIEW ONLY — no work authorized\n' : ''}${review.title}\nReview: ${review.reviewId}\nRevision: ${digest}\n${answer.status === 'cancelled' ? 'Not now — no work authorized' : summary(answer.decisions).join('\n\n')}\n\nWork area: ${review.workArea}\nExcluded: ${review.boundaries}`;
    $('status').textContent = 'Not sent. Return your choices in chat instead.';
    $('fallback').scrollIntoView({ behavior: 'smooth' });
  }
  async function send(answer) {
    if (busy) return;
    busy = true;
    const controls = [...document.querySelectorAll('input, textarea, button')].map(el => [el, el.disabled]);
    controls.forEach(([el]) => { el.disabled = true; });
    let failed = false;
    try {
      if (!token || location.protocol === 'file:') throw new Error('Collector unavailable');
      const response = await fetch('/answers', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Review-Token': token }, body: JSON.stringify(answer), signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`Collector returned ${response.status}`);
      const saved = await response.json();
      if (saved.ok !== true) throw new Error('Missing acknowledgement');
      document.querySelectorAll('input, textarea, button').forEach(el => { el.disabled = true; });
      $('confirmation').hidden = true;
      $('status').textContent = answer.status === 'cancelled' ? 'Not now recorded. No work authorized.' : (review.preview ? 'Preview choices saved. No project work authorized.' : 'Choices sent. Return to the conversation; the agent will restate the scope before continuing.');
      $('status').scrollIntoView({ behavior: 'smooth' });
    } catch { failed = true; fallback(answer); }
    finally { busy = false; if (failed) controls.forEach(([el, disabled]) => { el.disabled = disabled; }); }
  }
  document.querySelectorAll('input, textarea').forEach(el => el.addEventListener('input', update));
  cards.forEach(card => card.querySelector('.clear').addEventListener('click', () => {
    card.querySelectorAll('input').forEach(el => { el.checked = false; }); update();
  }));
  $('review').addEventListener('click', () => {
    pending = payload('submitted');
    $('choices').replaceChildren(...summary(pending.decisions, true).map(line => {
      const p = document.createElement('p'); p.textContent = line; return p;
    }));
    $('confirm-boundary').textContent = review.preview ? 'This is a preview. Confirming saves example choices only.' : `Confirming asks for only these selected actions in ${review.workArea} Not included: ${review.boundaries}`;
    $('confirmation').hidden = false; $('confirmation').focus(); $('confirmation').scrollIntoView({ behavior: 'smooth' });
  });
  $('edit').addEventListener('click', () => { $('confirmation').hidden = true; pending = null; $('review').focus(); });
  $('confirm').addEventListener('click', () => { if (pending) send(pending); });
  $('cancel').addEventListener('click', () => send(payload('cancelled')));
  $('copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('digest').value); $('copy-status').textContent = 'Copied. Paste into the conversation.'; }
    catch { $('digest').focus(); $('digest').select(); $('copy-status').textContent = 'Select and copy the highlighted text manually.'; }
  });
  update();
})();
