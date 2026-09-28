const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const notes = $('#notes');
const sampleBtn = $('#sampleBtn');
const analyzeBtn = $('#analyzeBtn');
const charCount = $('#charCount');
const emptyState = $('#emptyState');
const results = $('#results');
const statusPill = $('#statusPill');
const historyBtn = $('#historyBtn');
const historyCount = $('#historyCount');
const historyDialog = $('#historyDialog');
const historyList = $('#historyList');
const clearHistoryBtn = $('#clearHistoryBtn');
const closeHistoryBtn = $('#closeHistoryBtn');

const sample = `Checkout errors started after the 4pm release. Sam is looking at it. I rolled back the payments service and errors dropped, but I haven't checked mobile yet. There was one angry customer in chat. Need to check again tomorrow and tell support.`;
const STORAGE_KEY = 'relay-handoff-history-v1';
let currentAnalysis = null;

const patterns = {
  done: /\b(fixed|resolved|completed|finished|rolled back|reverted|tested|sent|updated|deployed|closed|confirmed|investigated|restarted)\b/i,
  pending: /\b(need(?:s|ed)? to|will|pending|next|follow[- ]?up|check|monitor|waiting|haven't|hasn't|todo|to do)\b/i,
  risk: /\b(error|issue|problem|risk|failed|failure|blocked|blocker|outage|down|broken|angry|urgent|incident|impact)\b/i,
  owner: /(?:\b(?:owner|assigned to|with|asked|tell|contact|by)\s+@?([A-Z][a-z]{1,20})\b)|(?:@([a-zA-Z0-9_-]{2,24}))/g,
  time: /\b(today|tomorrow|tonight|morning|afternoon|evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday|eod|cob|\d{1,2}(?::\d{2})?\s?(?:am|pm)|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)\b/gi,
  vague: /\b(asap|soon|later|tomorrow|sometime|maybe|probably|someone|somebody|should|a bit|again)\b/gi,
  evidence: /(?:https?:\/\/\S+)|(?:\b(?:INC|TKT|JIRA|CASE|PR|BUG)-?\d+\b)|(?:#\d{2,})/gi
};

function escapeHtml(value = '') {
  return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function splitSentences(text) {
  return text.replace(/\r/g, '').split(/(?:\n+|(?<=[.!?])\s+)/)
    .map((sentence) => sentence.trim().replace(/^[-•]\s*/, ''))
    .filter(Boolean).slice(0, 30);
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function extractOwners(text) {
  const owners = [];
  for (const match of text.matchAll(patterns.owner)) owners.push(match[1] || match[2]);
  for (const match of text.matchAll(/\b([A-Z][a-z]{1,20})\s+(?:is|will|owns|has|should|can)\b/g)) owners.push(match[1]);
  return unique(owners).filter((name) => !['The', 'This', 'That', 'Need'].includes(name));
}

function analyze(text) {
  const sentences = splitSentences(text);
  const done = sentences.filter((sentence) => patterns.done.test(sentence));
  const pending = sentences.filter((sentence) => patterns.pending.test(sentence));
  const risks = sentences.filter((sentence) => patterns.risk.test(sentence));
  const owners = extractOwners(text);
  const times = unique(text.match(patterns.time) || []);
  const pendingTimes = unique(pending.join(' ').match(patterns.time) || []);
  const vague = unique((text.match(patterns.vague) || []).map((word) => word.toLowerCase()));
  const evidence = unique(text.match(patterns.evidence) || []);
  const hasState = sentences.length > 0 && (risks.length > 0 || /\b(is|are|currently|status|started|remains?)\b/i.test(text));
  const hasOutcome = /\b(dropped|improved|working|stable|successful|passed|stopped|recovered|unchanged|worse|better|result)\b/i.test(text);
  const checks = [
    { name: 'Current state', detail: 'What is happening now', pass: hasState, weight: 20 },
    { name: 'Work completed', detail: 'What has already been tried', pass: done.length > 0, weight: 20 },
    { name: 'Clear owner', detail: 'Who owns the next move', pass: owners.length > 0, weight: 20 },
    { name: 'Specific timing', detail: 'When follow-up should happen', pass: pendingTimes.length > 0 && !pendingTimes.every((time) => /tomorrow|morning|afternoon|evening/i.test(time)), weight: 15 },
    { name: 'Next action', detail: 'What should happen next', pass: pending.length > 0, weight: 15 },
    { name: 'Evidence', detail: 'A result, ticket, or link', pass: evidence.length > 0 || hasOutcome, weight: 10 }
  ];
  const gaps = [];
  if (!checks[2].pass) gaps.push({ severity: 'high', title: 'No clear owner', question: 'Who is responsible for the next action?' });
  if (!checks[4].pass) gaps.push({ severity: 'high', title: 'Next step is unclear', question: 'What exactly should the next person do?' });
  if (!checks[3].pass) gaps.push({ severity: 'medium', title: 'Timing is vague', question: 'What exact time or deadline should replace words like “tomorrow” or “later”?' });
  if (!checks[5].pass) gaps.push({ severity: 'medium', title: 'No verification evidence', question: 'What result, ticket, link, or check proves the current status?' });
  if (!checks[1].pass) gaps.push({ severity: 'medium', title: 'Completed work is missing', question: 'What has already been tried so nobody repeats it?' });
  if (vague.length) gaps.push({ severity: 'medium', title: 'Ambiguous language', question: `Can you replace ${vague.slice(0, 3).map((word) => `“${word}”`).join(', ')} with something specific?` });
  const rawScore = checks.reduce((total, check) => total + (check.pass ? check.weight : 0), 0);
  const score = Math.max(8, Math.min(100, rawScore - Math.min(vague.length * 3, 9)));
  return {
    id: Date.now(), createdAt: new Date().toISOString(), original: text, score, checks, gaps: gaps.slice(0, 5),
    sections: {
      state: risks[0] || sentences[0] || 'Not stated',
      completed: done.length ? done : ['Not stated'],
      pending: pending.length ? pending : ['Not stated'],
      risks: risks.length ? risks : ['No explicit risks mentioned'],
      owners: owners.length ? owners : ['Unassigned'],
      timing: times.length ? times : ['No specific deadline'],
      evidence: evidence.length ? evidence : [hasOutcome ? 'Outcome described in the notes' : 'No evidence supplied']
    }
  };
}

async function analyzeWithGemini(text) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 14000);
  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: text }),
      signal: controller.signal,
      credentials: 'same-origin',
      cache: 'no-store',
      referrerPolicy: 'same-origin'
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'AI analysis failed');
    return {
      ...payload,
      id: Date.now(),
      createdAt: new Date().toISOString(),
      original: text,
      source: 'gemini'
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

function scoreLabel(score) {
  if (score >= 85) return ['Ready to relay', 'The next person has enough context to act.', '#24a98b'];
  if (score >= 65) return ['Almost ready', 'A few details would make this easier to own.', '#e4aa00'];
  return ['Needs a clearer baton pass', 'Resolve the biggest gaps before sending.', '#ff6f61'];
}

function buildHandoffText(data) {
  const bullets = (items) => items.map((item) => `- ${item}`).join('\n');
  return `HANDOFF\n\nCURRENT STATE\n${data.sections.state}\n\nCOMPLETED\n${bullets(data.sections.completed)}\n\nNEXT ACTIONS\n${bullets(data.sections.pending)}\n\nRISKS / BLOCKERS\n${bullets(data.sections.risks)}\n\nOWNER\n${data.sections.owners.join(', ')}\n\nTIMING\n${data.sections.timing.join(', ')}\n\nEVIDENCE\n${data.sections.evidence.join(', ')}`;
}

function renderAnalysis(data) {
  currentAnalysis = data;
  const [label, description, color] = scoreLabel(data.score);
  emptyState.hidden = true;
  results.hidden = false;
  statusPill.textContent = data.source === 'gemini' ? 'Gemini reviewed' : 'Local fallback';
  statusPill.classList.add('checked');
  const gapsHtml = data.gaps.length
    ? data.gaps.map((gap) => `<div class="gap-card ${gap.severity === 'medium' ? 'medium' : ''}"><div class="gap-label"><span></span>${escapeHtml(gap.title)}</div><p>${escapeHtml(gap.question)}</p></div>`).join('')
    : `<div class="all-clear"><strong>Clean baton pass.</strong><br />No major gaps were detected. Give the final handoff a quick human review before sending.</div>`;
  const section = (title, content, list = false) => `<div class="handoff-section"><h4>${title}</h4>${list ? `<ul>${content.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : `<p>${escapeHtml(content)}</p>`}</div>`;
  const handoffHtml = [section('Current state', data.sections.state), section('Completed', data.sections.completed, true), section('Next actions', data.sections.pending, true), section('Risks / blockers', data.sections.risks, true), section('Owner & timing', `${data.sections.owners.join(', ')} · ${data.sections.timing.join(', ')}`), section('Evidence', data.sections.evidence, true)].join('');
  const checksHtml = data.checks.map((check) => `<div class="check-item"><div><strong>${escapeHtml(check.name)}</strong><small>${escapeHtml(check.detail)}</small></div><span class="check-mark ${check.pass ? '' : 'missing'}">${check.pass ? '✓' : '!'}</span></div>`).join('');
  results.innerHTML = `
    <div class="score-row"><div class="score-ring"><strong>${data.score}</strong></div><div class="score-copy"><h3>${label}</h3><p>${description}</p></div></div>
    <div class="result-tabs" role="tablist" aria-label="Analysis views">
      <button class="tab-button active" type="button" role="tab" aria-selected="true" data-tab="gaps">Gaps (${data.gaps.length})</button>
      <button class="tab-button" type="button" role="tab" aria-selected="false" data-tab="handoff">Clean handoff</button>
      <button class="tab-button" type="button" role="tab" aria-selected="false" data-tab="checks">Quality check</button>
    </div>
    <div class="tab-panel gap-list" data-panel="gaps">${gapsHtml}</div>
    <div class="tab-panel handoff-sections" data-panel="handoff" hidden>${handoffHtml}</div>
    <div class="tab-panel check-list" data-panel="checks" hidden>${checksHtml}</div>
    <div class="result-actions"><button class="action-button primary" id="copyBtn" type="button">Copy handoff</button><button class="action-button" id="exportBtn" type="button">Download .txt</button><button class="action-button" id="resetBtn" type="button">Start over</button></div>`;
  const scoreRing = $('.score-ring', results);
  scoreRing.style.setProperty('--score', String(data.score));
  scoreRing.style.setProperty('--ring-color', color);
  $$('.tab-button', results).forEach((button) => button.addEventListener('click', () => activateTab(button.dataset.tab)));
  $('#copyBtn').addEventListener('click', copyHandoff);
  $('#exportBtn').addEventListener('click', exportHandoff);
  $('#resetBtn').addEventListener('click', resetApp);
}

function activateTab(name) {
  $$('.tab-button', results).forEach((button) => {
    const active = button.dataset.tab === name;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  $$('.tab-panel', results).forEach((panel) => { panel.hidden = panel.dataset.panel !== name; });
}

function getHistory() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(stored)) return [];
    return stored.map(sanitizeStoredAnalysis).filter(Boolean).slice(0, 6);
  } catch {
    return [];
  }
}

function sanitizeStoredAnalysis(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const score = Number(item.score);
  if (!Number.isFinite(score) || typeof item.original !== 'string' || item.original.length > 3000) return null;
  const safeString = (value, fallback = 'Not stated', max = 600) => typeof value === 'string' ? value.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max) || fallback : fallback;
  const safeList = (value, fallback) => {
    const list = Array.isArray(value) ? value.map((entry) => safeString(entry, '', 600)).filter(Boolean).slice(0, 8) : [];
    return list.length ? list : [fallback];
  };
  const sections = item.sections && typeof item.sections === 'object' ? item.sections : {};
  const gaps = Array.isArray(item.gaps) ? item.gaps.slice(0, 5).map((gap) => ({
    severity: gap?.severity === 'high' ? 'high' : 'medium',
    title: safeString(gap?.title, 'Missing detail', 80),
    question: safeString(gap?.question, 'What detail should be clarified?', 220)
  })) : [];
  const expectedChecks = [
    ['Current state', 'What is happening now'],
    ['Work completed', 'What has already been tried'],
    ['Clear owner', 'Who owns the next move'],
    ['Specific timing', 'When follow-up should happen'],
    ['Next action', 'What should happen next'],
    ['Evidence', 'A result, ticket, or link']
  ];
  const suppliedChecks = Array.isArray(item.checks) ? item.checks : [];
  const createdAt = Number.isNaN(Date.parse(item.createdAt)) ? new Date().toISOString() : new Date(item.createdAt).toISOString();
  return {
    id: Number.isFinite(Number(item.id)) ? Number(item.id) : Date.now(),
    createdAt,
    original: safeString(item.original, '', 3000),
    source: item.source === 'gemini' ? 'gemini' : 'local',
    score: Math.max(0, Math.min(100, Math.round(score))),
    gaps,
    checks: expectedChecks.map(([name, detail], index) => ({ name, detail, pass: Boolean(suppliedChecks[index]?.pass) })),
    sections: {
      state: safeString(sections.state),
      completed: safeList(sections.completed, 'Not stated'),
      pending: safeList(sections.pending, 'Not stated'),
      risks: safeList(sections.risks, 'No explicit risks mentioned'),
      owners: safeList(sections.owners, 'Unassigned'),
      timing: safeList(sections.timing, 'No specific deadline'),
      evidence: safeList(sections.evidence, 'No evidence supplied')
    }
  };
}

function saveHistory(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([data, ...getHistory().filter((item) => item.original !== data.original)].slice(0, 6)));
  updateHistoryCount();
}

function updateHistoryCount() {
  historyCount.textContent = String(getHistory().length);
}

function showToast(message) {
  let toast = $('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    toast.setAttribute('role', 'status');
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 1800);
}

async function copyHandoff() {
  if (!currentAnalysis) return;
  await navigator.clipboard.writeText(buildHandoffText(currentAnalysis));
  showToast('Handoff copied');
}

function exportHandoff() {
  if (!currentAnalysis) return;
  const blob = new Blob([buildHandoffText(currentAnalysis)], { type: 'text/plain;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `relay-handoff-${new Date().toISOString().slice(0, 10)}.txt`;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast('Handoff downloaded');
}

function resetApp() {
  notes.value = '';
  currentAnalysis = null;
  updateCount();
  results.hidden = true;
  results.innerHTML = '';
  emptyState.hidden = false;
  statusPill.textContent = 'Waiting for notes';
  statusPill.classList.remove('checked');
  notes.focus();
}

function renderHistory() {
  const history = getHistory();
  clearHistoryBtn.hidden = history.length === 0;
  historyList.innerHTML = history.length
    ? history.map((item, index) => `<button class="history-item" type="button" data-index="${index}"><strong><span>Readiness ${item.score}/100</span><time>${new Date(item.createdAt).toLocaleDateString()}</time></strong><p>${escapeHtml(item.original)}</p></button>`).join('')
    : '<div class="history-empty">Your recent checks will appear here.</div>';
  $$('.history-item', historyList).forEach((button) => button.addEventListener('click', () => {
    const item = history[Number(button.dataset.index)];
    notes.value = item.original;
    updateCount();
    renderAnalysis(item);
    historyDialog.close();
  }));
}

function updateCount() {
  charCount.textContent = `${notes.value.length.toLocaleString()} / 3,000`;
}

sampleBtn.addEventListener('click', () => {
  notes.value = sample;
  updateCount();
  notes.focus();
  showToast('Example loaded');
});

analyzeBtn.addEventListener('click', async () => {
  const text = notes.value.trim();
  if (!text) {
    notes.focus();
    notes.setAttribute('aria-invalid', 'true');
    showToast('Add your handoff notes first');
    return;
  }
  notes.removeAttribute('aria-invalid');
  analyzeBtn.disabled = true;
  analyzeBtn.textContent = 'Checking…';
  document.body.classList.add('is-checking');
  const minimumMotion = new Promise((resolve) => window.setTimeout(resolve, 650));
  try {
    let analysis;
    try {
      [analysis] = await Promise.all([analyzeWithGemini(text), minimumMotion]);
    } catch {
      await minimumMotion;
      analysis = { ...analyze(text), source: 'local' };
      showToast('Gemini unavailable—used local checks');
    }
    renderAnalysis(analysis);
    saveHistory(analysis);
  } finally {
    analyzeBtn.disabled = false;
    analyzeBtn.innerHTML = '<span>Check the handoff</span><i aria-hidden="true">→</i>';
    window.setTimeout(() => document.body.classList.remove('is-checking'), 320);
    if (window.matchMedia('(max-width: 850px)').matches) results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});

historyBtn.addEventListener('click', () => { renderHistory(); historyDialog.showModal(); });
closeHistoryBtn.addEventListener('click', () => historyDialog.close());
historyDialog.addEventListener('click', (event) => { if (event.target === historyDialog) historyDialog.close(); });
clearHistoryBtn.addEventListener('click', () => {
  localStorage.removeItem(STORAGE_KEY);
  updateHistoryCount();
  renderHistory();
  showToast('Recent handoffs cleared');
});
notes.addEventListener('input', updateCount);

function registerWebMcpTools() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const tool = {
    name: 'check_handoff_notes',
    title: 'Check handoff notes',
    description: 'Analyze rough handoff notes, show missing details, and create a grounded structured handoff in Relay.',
    inputSchema: { type: 'object', properties: { notes: { type: 'string', minLength: 1, maxLength: 3000 } }, required: ['notes'], additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    async execute(input) {
      if (!input || typeof input.notes !== 'string' || !input.notes.trim() || input.notes.length > 3000) throw new Error('notes must be a non-empty string of 3,000 characters or fewer');
      notes.value = input.notes.trim();
      updateCount();
      let analysis;
      try { analysis = await analyzeWithGemini(notes.value); }
      catch { analysis = { ...analyze(notes.value), source: 'local' }; }
      renderAnalysis(analysis);
      saveHistory(analysis);
      return { source: analysis.source, score: analysis.score, gaps: analysis.gaps, handoff: buildHandoffText(analysis) };
    }
  };
  Promise.resolve(context.registerTool(tool)).catch(() => {});
}

updateHistoryCount();
registerWebMcpTools();
