---
name: locchat-messenger-dev
description: "Mandatory pre-development workflow for the Loc&Chat (LocalChats) sales-console project. This skill should be used when developing or modifying any feature of the Loc&Chat messenger-inbox app — WhatsApp/Telegram/Viber integration, Evolution API worker, gramjs tg-worker, ingest/attribution pipeline, inbox UI, admin settings, channel pairing, or bug fixes touching messaging behavior. It enforces TDD-first, official messenger documentation research, GitHub prior-art search, and a written implementation plan BEFORE any production code is written. Trigger keywords — Loc&Chat, LocalChats, sales console, messenger integration, WhatsApp, Telegram, Viber, Baileys, Evolution API, gramjs, inbox, пейринг, атрибуция, инбокс, добавить фичу, доработать канал."
---

# Loc&Chat Messenger Development Workflow

## Purpose

Ensure that every functional change to the Loc&Chat messenger dashboard works on the
first real attempt. Messenger APIs (WhatsApp/Baileys/Evolution, Telegram/gramjs, Viber)
are full of undocumented version-specific behavior that generic knowledge does not cover
(e.g. Evolution v2.3.7 silently drops `@lid` inbound messages; it returns `name` not
`instanceName`). The only reliable way to ship working functionality is research before code.

## Mandatory Phase Order

Never write production code before completing phases 1–4 in order. Never skip a phase
because the task "looks simple" — version drift between messenger libraries has bitten
this project repeatedly.

### Phase 1 — Tests first (TDD)

1. Restate the requirement as observable behavior (inputs → expected outputs).
2. Write failing tests BEFORE production code:
   - Console (`src/`): pure logic (attribution, dedup, payload parsing, state reducers) →
     unit tests with plain sample payloads (record real API shapes into fixtures, do not invent them).
   - Worker (`worker/`): HTTP endpoints → tests against a local mock of the upstream API
     using REAL response shapes (see `references/project-context.md` for known shapes).
3. Run the tests, confirm they fail for the right reason.
4. Tests stay in the repo; they are part of the deliverable.

If the change is purely visual and has no logic, state this explicitly in the plan instead
of writing token tests.

### Phase 2 — Official documentation research

1. Identify which messenger/API surface the task touches.
2. Read the CURRENT official docs via web fetch (links in `references/messenger-docs.md`).
   Verify: endpoint paths, request/response field names, auth header format, rate limits,
   webhook event names, version-specific changes in the changelog/release notes.
3. Explicitly confirm field names against the ACTUAL deployed version (Evolution: check
   the image tag in `worker/fly/Dockerfile`; query the live worker with curl if unsure —
   read-only calls to our own worker are allowed).
4. Record findings in the plan: endpoint, auth, payload shape, error modes, limits.

Never trust remembered API shapes. Field-name drift between versions is the #1 source
of bugs in this project (Bearer vs `apikey` header, `qrcode` nesting, `name` vs `instanceName`).

### Phase 3 — GitHub prior-art search

1. Search GitHub (web search + repo issues) for how existing projects solve the same task:
   Baileys / Evolution API / WAHA / whatsapp-web.js for WhatsApp; gramjs / Telethon / grammY
   for Telegram; official Viber SDKs for Viber.
2. Read the open AND closed issues of the exact library version in use — recurring
   failure modes live there (LID handling, decryption drops, reconnect behavior, rate limits).
3. Decide: reuse an approach, borrow the contract, or copy a proven workaround. Cite the
   issue/PR in the plan.

### Phase 4 — Implementation plan

Write the plan to the chat (or `docs/plans/` for large features) containing:

- **Behavior**: what changes from the user's perspective.
- **Findings**: Phase 2 + Phase 3 results — endpoints, payload shapes, version constraints,
  prior-art links.
- **Test list**: from Phase 1, mapped to behaviors.
- **Files to change**: exact paths (`src/lib/...`, `worker/...`).
- **Risks/limits**: rate limits, ban risk, version drift, rollout/cleanup steps
  (e.g. delete stale instances, re-pair sessions).

Get user approval for anything beyond a bug fix before implementing.

### Phase 5 — Implement, verify, ship

1. Implement minimally; make Phase 1 tests pass.
2. Verify: `npm run build` for console; for worker changes deploy to Fly only after a
   local mock run, then verify on the live worker (`/healthz`, endpoint smoke tests).
3. Publish console + push git when behavior is confirmed.

## Hard Rules

- Inbound-only product: never add broadcast/mass-send features; replies only.
- Never invent API response shapes — capture real ones (curl the worker or read library source).
- Secrets (API keys, salts) stay in env/`~/.fly/`; never in source, never in docs.
- Console `localStorage` state and remote Supabase saves must stay schema-compatible:
  validate remote payload shape before merging.

## References

- `references/project-context.md` — Loc&Chat architecture, deployed versions, known API
  shapes and past bugs. Read this FIRST on every task.
- `references/messenger-docs.md` — official documentation and issue-tracker links per channel.
