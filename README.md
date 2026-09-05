# LocalChats · Sales Console

Єдиний інбокс месенджерів для відділу продажів: робочі та особисті WhatsApp/Telegram в одному
інтерфейсі, з UTM-атрібуцією вхідних і режимом **inbound-only** (лише відповіді на вхідні,
без розсилок).

## Зміст документації

| Документ | Про що |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Архітектура застосунку: шари, потік даних, інтеграції, діаграми |
| [docs/backend-adapters.md](docs/backend-adapters.md) | Шар даних: контракт `DataBackend`, готові адаптери, як підключити свою БД/бекенд |
| [docs/deployment.md](docs/deployment.md) | Розгортання в прод: воркер сесій, домен, Supabase, бюджет, чек-лист |

## Можливості

- **Єдиний інбокс** — робочі номери компанії та особисті номери співробітників в одному списку діалогів; особисте листування бачить лише власник номера.
- **Підключення номерів за QR** — пряма сесія через воркер (Evolution API для WhatsApp, gramjs для Telegram), як у WhatsApp Web. Без Business-пакетів.
- **UTM-атрібуція** — мітка `#XXXXXXXX` з deep link → `exact`; матчинг за недавнім кліком → `fallback`; решта → `direct`. Експорт GCLID у CSV для Google Ads.
- **Демо і прод** — демо-режим (симулятор вхідних, фейковий QR) для тестів інтерфейсу, прод-режим із реальними сесіями через воркер.
- **Перемикна архітектура даних** — localStorage, Supabase або будь-який власний REST-сервер; змінюється в налаштуваннях без втрати даних.

## Швидкий старт

```bash
npm install
npm run dev      # локальна розробка
npm run build    # продакшен-збірка в dist/
```

- **Демо-режим** працює одразу після входу, без жодних серверів.
- **Прод-режим**: Налаштування/Адмінка → Інтеграції → вказати URL і API-ключ воркера сесій,
  переключити режим на «Продакшен».
- **Архітектура даних**: Налаштування → «Архітектура даних» → обрати localStorage / Supabase / REST.

## Стек

- **Frontend**: React 19 + Vite + TypeScript, один реактивний стор (`useSyncExternalStore`), без зовнішніх стейт-менеджерів.
- **Auth**: Verdent-managed Supabase Auth (Google / email+password) через `@verdent/auth-js`.
- **Дані**: підключний шар `DataBackend` (див. [docs/backend-adapters.md](docs/backend-adapters.md)).
- **Воркер сесій**: Evolution API (WhatsApp-особисті) + gramjs (Telegram-особисті) в окремому контейнері; контракт — `src/lib/worker.ts`.
- **Схема БД** (етап 2): `supabase/schema.sql`.
