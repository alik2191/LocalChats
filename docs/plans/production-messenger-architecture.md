# План перехода LocalChats к production messenger-платформе

Дата: 2026-09-06
Статус: ожидает утверждения перед изменением production-кода.

## 1. Зафиксированные решения

- Каналы первой очереди: WhatsApp (рабочие и личные через QR), Telegram (боты и личные через QR), Viber (только рабочий Bot/PA).
- Основное хранилище на старте: Base44 Entities + Auth + RLS + realtime.
- Второе хранилище: Supabase, подключаемое тем же контрактом с миграцией, сверкой и управляемым переключением.
- Worker-профили: LocalChats Worker и Custom Worker. Выбор и health check находятся в настройках.
- UI, transport, storage и бизнес-правила не обращаются друг к другу напрямую; взаимодействие только через небольшие контракты.
- Текущий рабочий демо-интерфейс сохраняется до готовности production-модулей; переключение выполняется feature flags после проверок.

## 2. Бесплатные варианты worker

### Вариант A — LocalChats Worker на Oracle Cloud Always Free (рекомендуемый)

- Ubuntu ARM VM.Standard.A1.Flex: до 2 OCPU и 12 GB RAM в актуальном Always Free лимите, 200 GB общего block storage.
- Один Docker Compose bundle: gateway/router, Evolution API, Redis, gramjs worker, Viber webhook adapter и monitoring endpoints.
- Подходит для первоначальной нагрузки небольшой/средней sales-команды и нескольких/десятков активных сессий; фактический предел подтверждается нагрузочным тестом.
- Ограничения: дефицит A1 capacity в регионе; Oracle может reclaim idle free VM. Нужны backup, uptime monitor и план быстрого восстановления.

### Вариант B — Custom Worker на собственном always-on ПК/NAS/сервере

- Тот же Docker Compose bundle запускается на существующем Linux-хосте.
- Cloudflare Tunnel публикует API через исходящее соединение без открытого входящего порта.
- Стоимость хостинга нулевая при наличии оборудования; ёмкость зависит от RAM/CPU и качества интернета.
- Ограничения: электричество, домашний интернет и обслуживание становятся зоной ответственности владельца.

Fly.io/обычный VPS остаются платным fallback, но не относятся к гарантированно бесплатным вариантам.
Base44 Functions не подходят для постоянных WhatsApp/Telegram-сессий: они используются как безопасный gateway/orchestrator, а долгоживущий процесс работает на worker.

## 3. Переключение worker

Контракт MessengerWorker:

- health()
- capabilities()
- startPairing(channel, owner)
- getPairingStatus(pairingId)
- cancelPairing(pairingId)
- disconnect(accountId)
- sendReply(conversationId, text)
- fetchIncoming(cursor)
- acknowledge(cursor)

Профили:

- localchats: наш стандартный worker bundle;
- custom: внешний URL, реализующий совместимый gateway contract.

Настройки хранят только профиль и несекретные параметры. URL и ключи worker находятся в server-side secrets. Переключение UI-провайдера выполняется без изменения Inbox, но активные WhatsApp/Telegram-сессии нельзя бесшовно перенести между разными worker без переноса зашифрованного session volume. При смене worker система либо проверяет импорт совместимого session backup, либо требует повторный QR-pairing. Нельзя обещать перенос сессии там, где провайдер его не поддерживает.

## 4. Переключение Base44 / Supabase

Контракт DataBackend:

- conversations, messages, contacts, channels, memberships;
- attribution events, clicks, leads, journal;
- attachments metadata;
- cursor-based ingest и idempotent upsert по external_id;
- realtime subscription или polling fallback;
- health и schemaVersion.

Реализации:

1. Base44Backend — основной production backend первой версии.
2. SupabaseBackend — внешний backend через защищённый server gateway/REST, без секретного ключа в браузере.

Миграция:

1. Применить versioned SQL migrations и RLS в Supabase.
2. Перенести данные пакетами с checkpoint и idempotency key.
3. Сверить количество записей, контрольные суммы и ссылки между сущностями.
4. Включить временный dual-write и сравнение чтения.
5. Остановить переключение при любом расхождении.
6. Переключить active backend только после полной проверки.
7. Сохранить rollback на Base44 до завершения контрольного периода.

Base44 не предоставляет готовый двусторонний production-sync с внешним Supabase, поэтому migration/sync gateway является отдельным проектным модулем.

## 5. Модульность

Каждая зона имеет отдельные контракты, сервисы, hooks и UI-компоненты. Один файл — одна ответственность и один основной export. Новые UI-компоненты держать небольшими; большие экраны только компонуют блоки.

Модули:

- core/config — feature flags и выбор профилей;
- core/auth — текущий пользователь и роли;
- data/contracts, data/base44, data/supabase, data/migrations;
- messaging/contracts, messaging/gateway;
- messaging/whatsapp, messaging/telegram, messaging/viber;
- pairing — lifecycle, QR, timeout, cleanup;
- inbox — conversations, thread, unread, realtime;
- privacy — ownership и разрешения;
- attribution — redirect, exact/fallback/direct;
- crm — Zoho adapter отдельно от Inbox;
- reports — read models и exports;
- settings — backend/worker/channel profiles;
- observability — health, audit, structured logs.

Отключение адаптера не должно ломать остальные модули: capability registry скрывает недоступные действия, а UI показывает scoped состояние unavailable.

## 6. Порядок реализации

### Этап 0 — защитная сетка

- Зафиксировать observable behavior текущего Inbox, Connections, Attribution и Reports.
- Добавить тесты на существующие сценарии до рефакторинга.
- Добавить feature flags demo/production без изменения текущего поведения.
- Критерий: текущая сборка и тесты проходят без визуальной/функциональной регрессии.

### Этап 1 — контракты и нормализованная Base44-модель

- Создать небольшие storage/worker contracts и registries.
- Создать сущности users memberships, channels, accounts, contacts, conversations, messages, attachments, clicks, attribution matches, leads, ingest cursors и audit events.
- Настроить RLS: рабочие данные по membership; личные каналы только владельцу; admin имеет контролируемый доступ.
- Перенести демо-данные через adapter, не удаляя fallback до проверки.
- Критерий: два пользователя не видят личные чаты друг друга; рабочие чаты видны разрешённой команде.

### Этап 2 — Inbox production core

- Перевести Inbox с mockData/localStorage на DataBackend.
- Realtime updates, unread, pagination, idempotent message upsert, attachments metadata.
- Запретить отправку без допустимого входящего контекста; сохранить inbound-only.
- Критерий: входящее событие создаёт/обновляет один диалог, повтор не дублируется, ответ проходит только при разрешении.

### Этап 3 — Worker gateway и pairing lifecycle

- Server-side gateway для профилей localchats/custom; secrets никогда не отдаются браузеру.
- Health/capabilities, pairing start/status/cancel, timeout cleanup, disconnect.
- Audit всех административных операций.
- Критерий: отмена, timeout и повторный запуск не оставляют zombie instance и не создают дубликат канала.

### Этап 4 — WhatsApp

- Evolution API v2.3.7 contract, apikey auth, name/instanceName compatibility, QR top-level/legacy parsing.
- Поддержка @s.whatsapp.net и @lid, игнорирование group/newsletter если они не разрешены.
- Poll/webhook ingest, clock skew allowance, reply send and delivery state.
- Нагрузочный и reconnect test на фактическом image tag.

### Этап 5 — Telegram

- Рабочие боты через Bot API webhook.
- Личные аккаунты через gramjs QR login и encrypted StringSession на worker.
- FLOOD_WAIT/backoff, cursor only after successful fetch, revoke/disconnect cleanup.

### Этап 6 — Viber рабочий

- Только Bot/PA webhook.
- Проверка X-Viber-Content-Signature по raw body до parsing.
- Deep-link context attribution и reply rules.
- UI не предлагает personal Viber.

### Этап 7 — Attribution, CRM и reports

- Реальный /c/:click_id redirect с allowlist target, ip_hash/ua_hash, UTM/GCLID.
- exact по метке, fallback по недавнему click fingerprint, иначе direct.
- Manual Zoho lead action через отдельный adapter; отсутствие Zoho не ломает контактную панель.
- Google Ads offline conversion CSV с timezone, conversion name/time/value/currency.
- Единый date filter для cards/chart/table.

### Этап 8 — Supabase adapter и миграции

- Versioned SQL schema, indexes, RLS, realtime publications.
- Migration runner, dry run, checkpoints, verification, dual-write, cutover, rollback.
- Настройки показывают health/schema version/read-write test до разрешения переключения.

### Этап 9 — production hardening

- Rate limits, request signing, replay protection, encryption at rest, backups.
- Structured logs без токенов/текста личных сообщений.
- Uptime/queue lag/session status dashboards.
- Build, unit, integration, privacy, migration, load and recovery tests.

## 7. Минимальный acceptance suite

- Личный канал видит только владелец; рабочий — только члены workspace.
- QR pairing создаёт ровно один account/channel; cancel/timeout полностью очищают worker.
- Повтор webhook/poll payload не дублирует сообщение.
- @lid WhatsApp inbound появляется в Inbox.
- Telegram FLOOD_WAIT не вызывает цикл повторов и не теряет cursor.
- Неверная подпись Viber отклоняется до JSON parsing.
- Исходящий ответ запрещён вне inbound policy.
- Exact/fallback/direct дают ожидаемый результат на реальных fixtures.
- Переключение backend блокируется при несовпадении migration verification.
- Отключение любого channel/CRM/report module не ломает загрузку приложения.

## 8. Риски

- Неофициальные личные WhatsApp-сессии сохраняют риск блокировки; inbound-only снижает, но не устраняет его.
- Бесплатная OCI capacity не гарантирована, idle VM может быть reclaimed.
- Session state не переносим между произвольными сторонними worker автоматически.
- Supabase free plan и Base44 plan имеют лимиты; нагрузочный порог фиксируется тестом, а не обещанием.
- Viber personal pairing технически отсутствует.

## 9. Исследованные первичные источники

- Oracle Always Free resources: https://docs.oracle.com/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- Cloudflare Tunnel: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/
- Supabase migrations: https://supabase.com/docs/guides/local-development/database-migrations
- Telegram user authorization: https://core.telegram.org/api/auth
- Evolution API docs/releases/issues из .verdent/skills/locchat-messenger-dev/references/messenger-docs.md
- Base44 Entities/RLS/realtime/backend functions: официальная Base44 developer documentation.
