# Loc&Chat Project Context

Read this first on every task. Facts below are verified against the live deployment.

## Architecture

- **Console** (`src/`, Vite + React + TS, Svelte-store-like state in `src/lib/store.ts`):
  - UI: Inbox (dialogs/chat), Channels, Admin (superadmin only), Settings, Attribution, Reports.
  - State: `localStorage` (`localchats_console_v1`) + optional remote save to Supabase
    (debounced, serialized; validate remote payload shape before merging).
  - Auth: Verdent-managed Supabase Auth; superadmin `alik2191@gmail.com`.
  - Production ingest: `pollWorkerIncoming()` polls worker every 15 s — WA via
    `POST /chat/findMessages/{instance}`, TG via `GET /tg/inbox?since=`; dedup by
    `external_id` → attribution (exact/fallback/direct) → dialog + message.
  - Production replies: WA `POST /message/sendText/{instance}` (number = digits),
    TG `POST /tg/send` (needs `TG_API_ID/TG_API_HASH` on the worker).
- **Worker** (single Fly container, `localchats-worker.fly.dev`, region fra):
  - Evolution API v2.3.7 (image `evoapicloud/evolution-api:v2.3.7`) on :8080, dir `/evolution`.
  - Baileys upgraded INSIDE the image to `7.0.0-rc14` (rc.9 loses `@lid` inbound — see bugs).
  - tg-worker (gramjs) :8787, gateway (clicks `/c/{id}`, `/clicks`) :8788,
    router :8081 (`worker/fly/router.mjs`) routes by path prefix; CORS pinned to console origin.
  - WA instance data on Fly volume `/data` (sessions survive restarts).
  - Secrets in Fly env (`API_KEY`, `SESSION_ENCRYPTION_KEY`, `CLICK_HASH_SALT`,
    `CONSOLE_ORIGIN`); local copy `~/.fly/localchats_secrets`, deploy token `~/.fly/deploy_token`.
- **Deploy**: console → Verdent publish pipeline; worker → `flyctl deploy` from `worker/`.

## Known API Facts (verified live, do not re-derive)

### Evolution API v2.3.7
- Auth: `apikey` header. `Authorization: Bearer` alone → 401. Send BOTH.
- `GET /instance/fetchInstances` → array with field `name` (NOT `instanceName`),
  `connectionStatus` ('open'|'close'|'connecting'), `number`, `ownerJid` (often null).
- `GET /instance/connectionState/{name}` → `{instance:{instanceName, state}}` (uses
  `instanceName` here!). `state: 'open'` = connected.
- `POST /instance/create` body `{instanceName, qrcode:true, integration:'WHATSAPP-BAILEYS'}`.
- `GET /instance/connect/{name}` → v2.3+: QR at TOP level `{base64, code, pairingCode?}`;
  older versions nested under `qrcode`. Parse both. `base64` is a ready PNG.
- `POST /chat/findMessages/{instance}` — IGNORES `limit` and `where` body params
  (returns latest ~50 records). Records: `key:{remoteJid,id,fromMe}`, `message`,
  `messageTimestamp` (SECONDS), `pushName`. Order: newest first.
- `DELETE /instance/logout/{name}`, `DELETE /instance/delete/{name}` (idempotent-ish).
- WA JIDs: `@s.whatsapp.net` (phone), `@lid` (new WhatsApp privacy IDs), `@g.us` groups,
  `@newsletter`. Inbound from LID contacts may arrive as `@lid`.

### gramjs / Telegram worker
- Worker endpoints: `GET /tg/qr`, `GET /tg/status?token=`, `POST /tg/send`, `GET /tg/inbox?since=`.
- Without `TG_API_ID/TG_API_HASH` env → 503 from `/tg/qr`.

## Past Bugs (root causes — check the same class of problem)

1. **@lid inbound lost** (2026-09): Baileys 7.0.0-rc.9 failed to decrypt inbound messages
   from `@lid` contacts; only receipts arrived. Fix: bump Baileys to rc14 inside the image
   (evolution-foundation issues #1872, #2582, #2638). Symptom was "instance open but zero
   new messages stored" — check Message storage, not console, when diagnosing.
2. **`name` vs `instanceName`**: console matched channels against `instanceName` → status
   sync never matched on v2.3.7. Fix: accept `i.instanceName ?? i.name`.
3. **401 on link-check**: Evolution v2 rejects Bearer-only. Fix: `apikey` header everywhere.
4. **"Воркер не повернув QR"**: v2.3 moved QR to top level of `/instance/connect` response.
   Fix: parse both formats.
5. **better-sqlite3 on Fly (musl)**: prebuilt glibc binaries crash → rebuild from source
   in Dockerfile.
6. **Pairing races**: concurrent pairings must not both create channels; timeout/Escape
   must logout+delete the instance, never leave a "connected" zombie. Stale seq/cancel →
   cleanup path.
7. **Clock skew**: WA freshness window compares client clock to Evolution server
   timestamps → keep 5 min skew allowance; TG watermark only advances after a successful fetch.

## Conventions

- Language: UI strings and comments — Ukrainian; user-facing docs — Russian; code identifiers — English.
- Inbound-only: replies to incoming messages only; no broadcasts, no templates for outreach.
- Console deploy contract: `npm run build` must pass; `.verdentc.json` defines publish build.
