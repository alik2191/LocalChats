# Official Messenger Documentation & Issue Trackers

Fetch docs LIVE (web_fetch/web_search) on every Phase 2 — they change often.
Verify against the version actually deployed (see `project-context.md`).

## WhatsApp (personal numbers — Baileys via Evolution API)

- Evolution API docs: https://doc.evolution-api.com
- Evolution API repo + releases (changelogs!): https://github.com/evolution-foundation/evolution-api/releases
- Evolution API issues (LID, delivery, session bugs live here): https://github.com/evolution-foundation/evolution-api/issues
- Baileys repo: https://github.com/WhiskeySockets/Baileys
- Baileys releases/issues: https://github.com/WhiskeySockets/Baileys/releases
- WhatsApp Web protocol changes / multidevice: search Baileys issues first — Meta ships
  silent protocol changes (LID migration, prekey rotation) that break clients.
- Known bug clusters: `@lid` JID handling (#1872 meta-issue), undecrypted inbound drops
  (#2582), outbound pending with Baileys rc.9 (#2638 — fix = bump Baileys inside image).
- Alternatives to check for prior art: WAHA (https://github.com/devlikeapro/waha),
  whatsapp-web.js (https://github.com/pedroslopez/whatsapp-web.js), WPPConnect.

## Telegram

- Official Bot API: https://core.telegram.org/bots/api (bot scenarios; rate limits FAQ:
  https://core.telegram.org/bots/faq — ~30 msg/s global, 1 msg/s per chat, 429 not ban)
- MTProto (personal accounts): https://core.telegram.org/api/obtaining_api_id
  (needs api_id/api_hash from my.telegram.org)
- gramJS (our tg-worker): https://github.com/gram-js/gramjs — docs + examples dir;
  QR login: `exportLoginToken`; StringSession persistence (encrypt at rest).
- Telethon (Python prior art, richest docs): https://docs.telethon.dev
- FLOOD_WAIT handling patterns: search gramjs/Telethon issues before implementing
  any polling/reply loop.

## Viber (future — Bot API only)

- Bot API: https://partners.viber.com / https://developers.viber.com/docs/api/python-bot-api/
- Webhook signature: `X-Viber-Content-Signature` = HMAC-SHA256(raw body, auth token) —
  verify BEFORE parsing.
- PA deep links: `viber://pa?chatURI=...&context=<tag>` (exact attribution).
- No personal-account protocol exists — do not attempt.

## Meta / policy constraints (apply to every channel)

- Inbound-only design (replies within 24 h WA window; no broadcasts) — this is the core
  ban-avoidance strategy of the product; every plan must preserve it.
- Ban-risk checklist for new features: frequency caps, link handling in first outbound
  message to unknown contacts, per-contact opt-out ("стоп") handling.

## Google Ads / attribution (console)

- GCLID offline conversions: https://developers.google.com/google-ads/api/docs/conversions/upload-clicks
- CSV import format: `Parameters: TimeZone=Europe/Kyiv` (manual flow already implemented).
