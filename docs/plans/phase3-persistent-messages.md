# Фаза 3 — персистентные сообщения и общий слой данных

Статус: в работе. Принцип: poll остаётся быстрым путём для текущего браузера,
webhook → Supabase — источник правды (переживает смену браузера, виден всем сотрудникам).

## Поведение (что меняется для пользователя)

1. Входящие WA/TG сохраняются воркером в общие таблицы Supabase (`channels`, `conversations`, `messages`) через вебхук Evolution — история не теряется при очистке localStorage и видна на любом устройстве.
2. Консоль в прод-режиме подтягивает общие данные (каналы/диалоги/сообщения) и мержит в локальный стейт → рабочий канал, подключённый админом, виден каждому сотруднику; личные — только владельцу (RLS).
3. Ответы консоли записываются в общую таблицу `messages` (direction='out').
4. Разовый backfill переносит полную историю из Postgres Evolution в Supabase.

## Findings (проверено по докам/живой системе)

### Evolution API v2.3.7 webhook
- Настройка per-instance: `POST /webhook/set/{instance}` (заголовок `apikey`), body
  `{webhook:{enabled, url, byEvents:false, base64:false, headers:{...}, events:['MESSAGES_UPSERT']}}`.
  Кастомные заголовки поддерживаются → секрет передаём как `x-webhook-secret`.
- Payload: `{event:'messages.upsert', instance, data:{key:{remoteJid, fromMe, id},
  message:{conversation|extendedTextMessage.text|imageMessage.caption...},
  messageTimestamp (секунды), pushName}, date_time, sender}`.
  `data` может быть массивом при батче — обрабатываем оба варианта.
- Исходящие тоже приходят как `messages.upsert` с `fromMe:true`
  (evolution-foundation#1340) → direction='out'.
- Retry: экспоненциальный backoff только на 5xx → эндпоинт отвечает 200 быстро,
  идемпотентность через UNIQUE `messages.external_id` (ignore-duplicates).
- Вебхук надёжнее, чем `findMessages`-поллинг (issue #2582: поллинг-окно теряет события).

### Postgres Evolution (проверено запросом в живой БД `localchats-db`)
- Таблица `Message`: `id` (text), `key` (jsonb, `{remoteJid, fromMe, id}`),
  `message` (jsonb), `messageType`, `messageTimestamp` (integer, секунды),
  `pushName`, `sessionId` (имя инстанса), `status`, `instanceId`.

### Supabase (Verdent-managed)
- URL: `https://supabase-api-prod.verdent.ai/p/p69e70425777d9d0137f9` (publishable key есть).
- Для записи воркеру нужен `SUPABASE_SECRET_KEY` (service role) как Fly-секрет —
  значение из настроек Verdent/Supabase (даёт пользователь).
- RLS уже даёт кросс-пользовательское чтение (channels/conversations/messages select).
- Prior art: resend-webhooks-ingester (секрет-заголовок + service-role запись, upsert
  по natural key) — заимствован контракт; WAHA/Chatwoot используют ту же схему
  webhook→DB с дедупом по external id.

## Схема БД (миграция через mcp_verdent_supabase_migration)

- `channels`: + колонка `instance text unique` (имя инстанса Evolution / TG-сессии).
- RPC `upsert_incoming_message(p_instance, p_external_chat_id, p_contact_name,
  p_external_id, p_direction, p_body, p_ts)` → security definer, service-role:
  ищет канал по instance, upsert диалога (channel_id, external_chat_id),
  вставляет сообщение с дедупом, обновляет last_message_at. Возвращает conversation_id
  или null (канал не найден).
- Политика: `messages` insert for authenticated with check (direction = 'out').

## Тесты (TDD)

Worker (`worker/ingest/test/*.test.mjs`, vitest, fetch замокан):
1. Валидный `messages.upsert` → RPC вызван с корректными полями; `fromMe:true` → 'out'.
2. `data` массив → N вызовов; объект → 1.
3. Неверный/отсутствующий `x-webhook-secret` → 401, без обращений к Supabase.
4. Не-`messages.upsert` события → 200, без обращений.
5. Группы/рассылки (`@g.us`, `@broadcast`, `@newsletter`) → пропуск.
6. RPC вернул null (канал не найден) → пропуск, 200.
7. Ошибка Supabase → 500 (Evolution сделает retry).
8. Извлечение текста: `conversation` / `extendedTextMessage.text` / `imageMessage.caption`;
   пустое тело → пропуск.

Console (`src/lib/*.test.ts`, vitest):
9. Маппинг строк БД → Channel/Conversation/Message + валидация формы (битые строки отбрасываются).
10. Мерж общего стейта не затирает локальные UI-настройки и не дублирует по external_id.

## Файлы

- `worker/ingest/src/server.mjs` — новый сервис (:8082): `POST /ingest/evolution`,
  `POST /ingest/backfill` (секрет), `GET /ingest/healthz`.
- `worker/ingest/package.json`, `worker/ingest/test/` — тесты.
- `worker/fly/router.mjs` — маршрут `/ingest` → 8082.
- `worker/fly/Dockerfile`, `worker/fly/start.sh` — сборка/запуск ingest.
- `supabase/schema.sql` + миграция — колонка `instance`, RPC, политика insert out.
- `src/lib/shared.ts` (новый) — syncSharedState(): чтение общих таблиц, маппинг, мерж.
- `src/lib/store.ts` — вызов syncSharedState после входа и по интервалу; sendMessage
  пишет out-строку; attachWorkerInstances/пейринг апсертят каналы в БД.
- `src/App.tsx` — интервал синка общих данных (там же, где pollWorkerIncoming).

## Риски / ограничения

- Нужен `SUPABASE_SECRET_KEY` от пользователя (только на Fly, не в коде).
- `unread_count` в БД в этом milestone не используется (unread живёт локально).
- @lid-JID сохраняем в `external_chat_id` как есть (паритет с текущим пайплайном).
- Backfill батчами, UNIQUE external_id делает повтор безопасным.
- Rollout: deploy worker → секреты → `POST /webhook/set/{instance}` на живые инстансы →
  backfill → publish консоли.
