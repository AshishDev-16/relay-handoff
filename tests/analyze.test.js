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

test('normalizes untrusted model output into the Relay shape', () => {
  const result = normalizeAnalysis({ score: 145, gaps: [{ severity: 'unknown', title: '  Missing   owner ', question: ' Who owns it? ' }], checks: [{ pass: true }], sections: {} });
  assert.equal(result.score, 100);
  assert.equal(result.gaps[0].severity, 'medium');
  assert.equal(result.gaps[0].title, 'Missing owner');
  assert.equal(result.checks.length, 6);
  assert.equal(result.sections.owners[0], 'Unassigned');
});

test('rejects short notes before calling Gemini', async () => {
  const req = { method: 'POST', body: { notes: 'too short' }, headers: { 'x-forwarded-for': 'test-short' }, socket: {} };
  const res = mockResponse();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
});

test('returns a grounded structured Gemini analysis', async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = 'test-key';
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers['x-goog-api-key'], 'test-key');
    assert.doesNotMatch(options.body, /test-key/);
    return {
      ok: true,
      json: async () => ({
        interaction: {
          output_text: JSON.stringify({
            score: 80,
            gaps: [{ severity: 'medium', title: 'Timing is vague', question: 'What exact deadline applies?' }],
            checks: [{ pass: true }, { pass: true }, { pass: true }, { pass: false }, { pass: true }, { pass: true }],
            sections: {
              state: 'Checkout errors continue.', completed: ['Rolled back payments.'], pending: ['Check mobile.'], risks: ['Checkout errors continue.'], owners: ['Sam'], timing: ['Tomorrow'], evidence: ['Error volume dropped.']
            }
          })
        }
      }),
      headers: { get: () => null }
    };
  };
  try {
    const req = { method: 'POST', body: { notes: 'Checkout errors continue. Sam rolled back payments and needs to check mobile tomorrow.' }, headers: { 'x-forwarded-for': 'test-success' }, socket: {} };
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
