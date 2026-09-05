# Roadmap LocalChats · Sales Console

Оновлено: 2026-09-05. Джерело вимог — ТЗ «SALES CONSOLE → PRODUCTION» та `docs/architecture.md`.

## Фаза 1 — прод-режим особистих номерів (критичний шлях)

Статус: **в роботі**. Пакет деплою — `worker/`.

| # | Задача | Статус |
|---|---|---|
| 1 | Воркер сесій на VPS: docker-compose (Evolution API + Caddy TLS + tg-worker + gateway) | 🔄 пакет готовий у `worker/`, потрібен VPS і `docker compose up` |
| 2 | gramjs-мікросервіс для особистих Telegram (`/tg/qr`, `/tg/status`, `/tg/send`, QR-логін MTProto) | 🔄 реалізований у `worker/tg-worker` |
| 3 | Deep-link редирект `go.<домен>/c/:click_id` із записом кліків (ip_hash, ua_hash) та захистом від open redirect | 🔄 реалізований у `worker/gateway` |

Критерій готовності фази: `Перевірити зв'язок` в адмінці зелений → режим ПРОДАКШЕН
активується → реальний WA/TG номер підключається за QR → вхідне потрапляє в консоль.

## Фаза 2 — офіційні канали (без воркера, без ризиків)

| # | Задача | Оцінка |
|---|---|---|
| 4 | Telegram-бот: BotFather → setWebhook + secret_token → ingest | 0.5 дня |
| 5 | Viber PA: webhook + HMAC-перевірка підпису | 0.5 дня |
| 6 | WhatsApp Cloud API: verify + X-Hub-Signature-256, 24-годинне вікно | 1 день |

## Фаза 3 — еволюція шару даних (етап 2 з ТЗ)

| # | Задача | Оцінка |
|---|---|---|
| 7 | Нормалізована БД замість state-sync: `NormalizedBackend` над схемою `supabase/schema.sql` (conversations, messages, clicks, leads + RLS) | 2–3 дні |
| 8 | Supabase Realtime для живого інбоксу | 0.5 дня |
| 9 | Ingest-пайплайн: вебхук воркера/ботів → дедуп по external_id → атрібуція → unread | 1 день |

## Фаза 4 — CRM і реклама

| # | Задача | Оцінка |
|---|---|---|
| 10 | Zoho CRM: OAuth-обмін на бекенді, upsert лідів, field-mapping через `/settings/fields` | 1–2 дні |
| 11 | Авто-вивантаження GCLID у Google Ads API (offline conversions) | 1 день |

## Фаза 5 — експлуатація

- Алерти («воркер помер» → TG-повідомлення адміну), heartbeat-статистика.
- Призначення діалогів менеджеру (`assigned_to`) + RLS-політика.
- Бекапи, логи вебхуків (DLQ), ретраї черги з backoff.

## Поза скоупом (свідомо)

Розсилки, масові ініціативні повідомлення, ротация номерів, ферми акаунтів — не реалізовуємо
(політика inbound-only зафіксована в ТЗ).
