# Контекст проекта LocalChats для AI-разработки

> Сформировано по README.md, docs/architecture.md, docs/backend-adapters.md,
> docs/deployment.md, docs/roadmap.md, AGENTS.md и материалам
> .verdent/skills/locchat-messenger-dev/. Обновлено: 2026-09-05.

## Назначение продукта

LocalChats · Sales Console — единый inbound-only инбокс отдела продаж для рабочих и
личных WhatsApp/Telegram-каналов с приватностью личных диалогов, UTM/GCLID-атрибуцией,
созданием лидов и отчётностью. Рассылки и холодный исходящий контакт не входят в модель
продукта; разрешены ответы на входящие сообщения с учётом правил платформ.

## Неприкосновенные продуктовые правила

- Рабочие каналы видит команда, личные диалоги доступны только владельцу номера.
- Сохранять inbound-only: никаких рассылок и автоматического outreach.
- WhatsApp: учитывать 24-часовое окно ответа и риск блокировки.
- Viber поддерживается только через Bot/PA API; протокола личных аккаунтов нет.
- Перед изменением интеграций сверять актуальную официальную документацию и точную
  версию развёрнутого сервиса — нельзя полагаться на API-формы по памяти.
- Чисто визуальные изменения не должны менять бизнес-логику, хранение или интеграции.

## Архитектура

1. **UI** — React/Vite, экраны Inbox, Channels/Connections, Attribution, Reports,
   Admin и Settings. UI не обращается к хранилищу напрямую.
2. **Состояние** — единый AppState в src/lib/store.ts, реактивность через
   useSyncExternalStore. В состоянии сотрудники, каналы, диалоги, сообщения, клики,
   атрибуция, фильтры и pairing.
3. **Данные** — интерфейс DataBackend в src/lib/backend/ с реализациями local,
   Supabase и REST. localStorage всегда остаётся офлайн-кешем.
4. **Удалённое сохранение** — debounce около 800 мс и строго последовательная цепочка
   записей, чтобы медленный запрос не перезаписал более новое состояние.
5. **Сессии мессенджеров** — отдельный worker: Evolution API для WhatsApp,
   gramjs для Telegram, gateway для deep links.
6. **Конфигурация** — режим demo/prod, worker, Zoho и backend настраиваются отдельно;
   секреты не должны попадать в исходный код.

## Текущий прод-контур worker

- Evolution API v2.3.7; внутри образа Baileys обновлён до 7.0.0-rc14.
- Авторизация Evolution: заголовок apikey обязателен; Bearer без apikey даёт 401.
- GET /instance/fetchInstances возвращает name, а не instanceName.
- GET /instance/connectionState/{name}: состояние находится в instance.state.
- POST /instance/create: { instanceName, qrcode: true, integration: 'WHATSAPP-BAILEYS' }.
- GET /instance/connect/{name}: в v2.3 QR лежит на верхнем уровне как base64/code;
  для совместимости следует понимать и старый вложенный qrcode.
- POST /chat/findMessages/{instance} возвращает последние записи newest-first и может
  игнорировать limit/where; messageTimestamp задан в секундах.
- Telegram worker: GET /tg/qr, GET /tg/status?token=, POST /tg/send,
  GET /tg/inbox?since=. Без TG_API_ID/TG_API_HASH QR недоступен.
- Прод-инбокс опрашивает worker примерно каждые 15 секунд; дедупликация по external_id.

## Атрибуция

Основная цепочка: рекламный клик → deep-link redirect → входящее сообщение → matching →
lead/report. Метка #XXXXXXXX из deep link даёт exact; недавний совместимый клик даёт
fallback; отсутствие совпадения даёт direct. Redirect сохраняет click_id, UTM, GCLID,
ip_hash и ua_hash и выполняет безопасный 302 на wa.me, t.me или viber://. Нельзя
разрешать open redirect. GCLID экспортируется в CSV для офлайн-конверсий Google Ads.

## Известные ошибки, которые нельзя повторять

- @lid-входящие терялись на Baileys rc.9; исправление — rc14. Если инстанс открыт, но
  сообщений нет, сначала проверять хранилище сообщений Evolution, а не UI.
- fetchInstances использует name; поддерживать i.instanceName ?? i.name.
- Evolution v2 отклоняет Bearer-only — везде передавать apikey.
- QR в Evolution v2.3 перемещён на верхний уровень ответа; разбирать оба формата.
- better-sqlite3 под musl требует сборки из исходников.
- Параллельные pairing-процессы не должны создавать два канала. Отмена, Escape и timeout
  обязаны выполнить logout/delete и удалить zombie instance.
- Для WhatsApp учитывать до 5 минут clock skew; Telegram watermark обновлять только после
  успешного получения данных.

## Правила разработки

Для каждого функционального изменения соблюдать порядок:

1. Описать наблюдаемое поведение и сначала добавить падающие тесты. Для чистого UI явно
   указать, что изменение не затрагивает логику.
2. Прочитать текущую официальную документацию затронутой платформы и проверить фактическую
   развёрнутую версию, endpoint, headers, payload, limits и error modes.
3. Проверить issues/releases используемой библиотеки и найти подтверждённый prior art.
4. Подготовить план: поведение, результаты исследования, тесты, файлы, риски и rollout.
5. Реализовать минимально, запустить тесты и npm run build. Worker проверять локальным
   mock-тестом перед deploy.

Тестовые payload должны повторять реальные формы API, а не выдуманные структуры. Тесты
остаются в репозитории. Перед публикацией консоли npm run build обязан проходить.

## Развёртывание

- Console публикуется отдельно от worker.
- Для production личных WA/TG обязателен session worker; demo работает без него.
- Worker разворачивается из worker/ через docker compose/Fly-конфигурацию.
- Нужны HTTPS, корректный CONSOLE_ORIGIN/CORS и постоянный volume для сессий.
- Backend может оставаться local, либо переключаться на Supabase/REST через DataBackend.
- Server-only secrets хранятся только в окружении; публичная конфигурация не должна
  смешиваться с секретами.

## Roadmap

1. Завершить production-режим личных WA/TG: worker, QR pairing, deep-link gateway.
2. Добавить официальные Telegram Bot, Viber PA и WhatsApp Cloud API каналы.
3. Перейти от state-sync к нормализованной БД, RLS, realtime и ingest-дедупликации.
4. Довести CRM/рекламу: Zoho OAuth, создание лидов, Google Ads offline conversions.
5. Усилить эксплуатацию: мониторинг, резервное копирование, аудит и проверка готовности.

## Источники, которые читать перед изменениями

- README.md
- docs/architecture.md
- docs/backend-adapters.md
- docs/deployment.md
- docs/roadmap.md
- .verdent/skills/locchat-messenger-dev/SKILL.md
- .verdent/skills/locchat-messenger-dev/references/project-context.md
- .verdent/skills/locchat-messenger-dev/references/messenger-docs.md

Этот файл — навигационный конспект, а не замена исходной документации. При конфликте
приоритет имеют актуальный код, фактическая версия deployment и первичные документы.
