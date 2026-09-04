# Слой данных: подключаемая архитектура бэкенда

Консоль спроектирована так, чтобы хранилище данных не было привязано к конкретной платформе
(в том числе к Verdent). Экраны и бизнес-логика зависят только от интерфейса `DataBackend`,
поэтому БД/бэкенд меняется в любой момент — в **Настройки → «Архитектура данных»** — без
переписывания кода и без потери данных.

## Контракт

```ts
// src/lib/backend/types.ts
export type BackendKind = 'local' | 'supabase' | 'rest';

export interface DataBackend {
  readonly kind: BackendKind;
  /** Загрузить сохранённое состояние (null — ещё ничего не сохранено). */
  load(): Promise<AppState | null>;
  /** Сохранить состояние. Ошибки не должны ломать UI. */
  save(state: AppState): Promise<void>;
  /** Проверка доступности для экрана «Настройки». */
  health(): Promise<{ ok: boolean; detail: string }>;
}
```

## Как это работает

1. **localStorage всегда остаётся офлайн-кешем.** `store.ts` синхронно пишет состояние в
   `localchats_console_v1` при каждом изменении — приложение мгновенно запускается и работает
   даже офлайн.
2. При активном удалённом бэкенде каждое изменение **debounce-пушится** (800 мс) в него
   через `scheduleRemoteSave()`; ошибки глушатся — кеш всё равно сохранился.
3. После входа `App.tsx` один раз вызывает `pullRemoteState()`: удалённое состояние имеет
   приоритет над локальным кешем, локальные настройки UI (фильтры, открытый вид, выбранный
   диалог) сохраняются (`mergeRemote`).
4. Переключение бэкенда — мгновенное: меняется конфиг `connections.backend`, следующий
   `save` уходит уже в новый адаптер. Данные, оставшиеся в старом хранилище, не удаляются.

## Готовые адаптеры

### `local` — localStorage (по умолчанию)
Автономный режим и офлайн-кеш. Ничего не требует.

### `supabase` — Supabase (облако)
Полное состояние консоли сохраняется как `jsonb` в таблице `app_state`, по строке на
пользователя, доступ ограничен RLS (`user_id = auth.uid()`). Требуется активная сессия
Supabase Auth (вход в приложение). Схема:

```sql
create table if not exists app_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
```

### `rest` — любой собственный сервер
Универсальный адаптер для «своей архитектуры»: любого бэкенда на VPS, serverless,
Enterprise-сервера. Контракт из двух эндпоинтов:

```
GET  {baseUrl}/state   → 200 + JSON состояния | 204, если состояния ещё нет
PUT  {baseUrl}/state   → 2xx, тело запроса = JSON состояния
```

Авторизация: `Authorization: Bearer <apiKey>` (ключ настраивается в UI, необязателен).
CORS: сервер должен разрешать origin консоли для `GET/PUT /state`.

Простейший пример сервера на Node (без зависимостей):

```js
import { createServer } from 'node:http';
let state = null;
createServer((req, res) => {
  if (req.url === '/state' && req.method === 'GET') {
    if (!state) { res.writeHead(204); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(state);
  }
  if (req.url === '/state' && req.method === 'PUT') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => { state = body; res.writeHead(204); res.end(); });
    return;
  }
  res.writeHead(404).end();
}).listen(8080);
```

## Как добавить свой адаптер (например, Firebase / MongoDB / 1С)

1. Создайте `src/lib/backend/myBackend.ts`, реализуйте интерфейс `DataBackend`
   (`load` / `save` / `health`).
2. Зарегистрируйте его в `getBackend()` в `src/lib/backend/index.ts` и добавьте вариант
   в `BackendKind` (`types.ts`).
3. Добавьте пункт в селект «Архитектура данных» в `src/components/SettingsView.tsx`.
4. Если нужен свой формат/миграция — опишите схему в `supabase/schema.sql` или в отдельной
   миграции; `AppState` менять не нужно.

Никакие компоненты и `store.ts` при этом не меняются — это и есть независимость от
конкретной архитектуры.

## Плановая эволюция (этап 2)

Сейчас бэкенд хранит целостное состояние (state-sync). Следующий шаг — нормализованная
схема (`conversations`, `messages`, `clicks` — уже описана в `supabase/schema.sql`) с
Realtime-подписками и ingest-вебхуком от воркера. Для этого реализуется второй интерфейс
(например, `NormalizedBackend`) над тем же реестром адаптеров — UI снова не меняется.
