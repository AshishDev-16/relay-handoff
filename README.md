# Relay

Relay is an AI-powered handoff quality checker that turns rushed workplace notes into a clear, actionable update. It identifies missing owners, vague deadlines, unclear next steps, risks, and evidence before generating a structured handoff that is ready to share.

**Live app:** [relay-handoff.vercel.app](https://relay-handoff.vercel.app)

## Why Relay exists

Important context is often lost between shifts, teammates, or project owners. Relay gives the writer a quick quality check before the message is sent, helping the next person understand what happened, what remains, who owns it, and when it needs attention.

## Features

- Readiness score based on six practical handoff checks
- Specific follow-up questions for missing information
- Structured sections for state, completed work, next actions, risks, owners, timing, and evidence
- Copy-ready and downloadable handoffs
- Recent checks stored locally on the user's device
- Graceful local analysis when Gemini is temporarily unavailable
- Responsive interface for phones and laptops

## How it works

1. The user enters rough handoff notes.
2. A server-side Vercel Function sends the notes to Gemini with trusted instructions kept separate from the untrusted user content.
3. Gemini returns a constrained JSON response that is normalized before reaching the interface.
4. Relay displays the score, missing details, quality checks, and cleaned handoff.
5. If the model is unavailable, an on-device rules-based analyzer keeps the core experience usable.

## Technology

- Vanilla HTML, CSS, and JavaScript
- Vercel Functions
- Gemini Developer API
- Browser `localStorage` for recent handoffs
- Node.js test runner

## Security and privacy

- The Gemini API key stays in the server-side environment and is never shipped to the browser.
- Requests are protected by origin, content-type, body-size, input-shape, and control-character validation.
- Prompt instructions and user notes are sent in separate roles to reduce prompt-injection risk.
- Model output is normalized and escaped before rendering.
- Content Security Policy, HSTS, anti-framing headers, timeouts, token limits, and layered rate limiting reduce the public attack surface.
- Handoff notes are not stored in a server-side database. Recent history stays in the user's browser.

Do not submit confidential, medical, safety-critical, or otherwise sensitive information. Notes are sent to Gemini for processing.

## Run locally

```bash
git clone https://github.com/AshishDev-16/relay-handoff.git
cd relay-handoff
npm install
```

Copy `.env.example` to `.env.local`, add a Gemini API key, then start the Vercel development server:

```bash
npx vercel dev
```

Run the automated tests with:

```bash
npm test
```

## Development transparency

This is a **vibe-coded, AI-assisted project**. Ashish Kadu defined the problem, product requirements, user experience, visual direction, testing approach, security decisions, iterations, and deployment. AI coding tools helped generate and refine parts of the implementation. This disclosure is intentional: the project demonstrates the ability to direct, evaluate, improve, and responsibly ship an AI-built product—not a claim that every line was written by hand.

## Creator

Designed, directed, tested, and shipped by **Ashish Kadu**.
