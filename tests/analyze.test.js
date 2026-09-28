import test from 'node:test';
import assert from 'node:assert/strict';
import handler, { normalizeAnalysis } from '../api/analyze.js';

function mockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}

function jsonRequest(body, suffix = 'default', extraHeaders = {}) {
  return {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/json',
      'x-vercel-forwarded-for': `test-${suffix}`,
      host: 'relay-handoff.vercel.app',
      origin: 'https://relay-handoff.vercel.app',
      ...extraHeaders
    },
    socket: {}
  };
}

test('normalizes untrusted model output into the Relay shape', () => {
  const result = normalizeAnalysis({ score: 145, gaps: [{ severity: 'unknown', title: '  Missing   owner ', question: ' Who owns it? ' }], checks: [{ pass: true }], sections: {} });
  assert.equal(result.score, 100);
  assert.equal(result.gaps[0].severity, 'medium');
  assert.equal(result.gaps[0].title, 'Missing owner');
  assert.equal(result.checks.length, 6);
  assert.equal(result.sections.owners[0], 'Unassigned');
});

test('rejects short notes before calling Gemini', async () => {
  const req = jsonRequest({ notes: 'too short' }, 'short');
  const res = mockResponse();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
});

test('rejects cross-origin browser requests', async () => {
  const req = jsonRequest({ notes: 'A sufficiently long handoff note.' }, 'origin', { origin: 'https://attacker.example' });
  const res = mockResponse();
  await handler(req, res);
  assert.equal(res.statusCode, 403);
});

test('rejects non-JSON and oversized request bodies', async () => {
  const nonJson = jsonRequest({ notes: 'A sufficiently long handoff note.' }, 'type', { 'content-type': 'text/plain' });
  const nonJsonRes = mockResponse();
  await handler(nonJson, nonJsonRes);
  assert.equal(nonJsonRes.statusCode, 415);

  const oversized = jsonRequest({ notes: 'A sufficiently long handoff note.' }, 'oversized', { 'content-length': '16001' });
  const oversizedRes = mockResponse();
  await handler(oversized, oversizedRes);
  assert.equal(oversizedRes.statusCode, 413);
});

test('rejects unexpected fields and control characters', async () => {
  const extraField = jsonRequest({ notes: 'A sufficiently long handoff note.', admin: true }, 'shape');
  const extraFieldRes = mockResponse();
  await handler(extraField, extraFieldRes);
  assert.equal(extraFieldRes.statusCode, 400);

  const controls = jsonRequest({ notes: 'A handoff with a hidden\u0000 control.' }, 'controls');
  const controlsRes = mockResponse();
  await handler(controls, controlsRes);
  assert.equal(controlsRes.statusCode, 400);
});

test('returns a grounded structured Gemini analysis', async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = 'test-key';
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers['x-goog-api-key'], 'test-key');
    assert.doesNotMatch(options.body, /test-key/);
    const requestBody = JSON.parse(options.body);
    assert.match(requestBody.systemInstruction.parts[0].text, /untrusted data/);
    assert.match(requestBody.contents[0].parts[0].text, /Checkout errors continue/);
    assert.doesNotMatch(requestBody.systemInstruction.parts[0].text, /Checkout errors continue/);
    return {
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({
          score: 80,
          gaps: [{ severity: 'medium', title: 'Timing is vague', question: 'What exact deadline applies?' }],
          checks: [{ pass: true }, { pass: true }, { pass: true }, { pass: false }, { pass: true }, { pass: true }],
          sections: {
            state: 'Checkout errors continue.', completed: ['Rolled back payments.'], pending: ['Check mobile.'], risks: ['Checkout errors continue.'], owners: ['Sam'], timing: ['Tomorrow'], evidence: ['Error volume dropped.']
          }
        }) }] } }]
      }),
      headers: { get: () => null }
    };
  };
  try {
    const req = jsonRequest({ notes: 'Checkout errors continue. Sam rolled back payments and needs to check mobile tomorrow.' }, 'success');
    const res = mockResponse();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.score, 80);
    assert.equal(res.body.sections.owners[0], 'Sam');
    assert.equal(res.headers['Cache-Control'], 'no-store');
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  }
});
