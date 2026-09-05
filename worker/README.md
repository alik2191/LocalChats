# LocalChats Session Worker

Пакет деплою фази 1 (`docs/roadmap.md`): Evolution API (WhatsApp) + gramjs-мікросервіс
(Telegram QR-логін) + gateway (deep-link редирект) за Caddy з автоматичним TLS.

## Склад

| Сервіс | Порт (внутр.) | Призначення |
|---|---|---|
| `caddy` | 80/443 | TLS, маршрутизація: `/tg/*` → tg-worker, решта → evolution |
| `evolution` | 8080 | WhatsApp-сесії (Baileys) — контракт консолі `/instance/*`, `/message/sendText/*` |
| `tg-worker` | 8787 | Telegram особисті: `GET /tg/qr`, `GET /tg/status`, `POST /tg/send`, `GET /tg/inbox` |
| `gateway` | 8788 | `GET /c/:click_id` — редирект на месенджер + запис кліку (ip_hash/ua_hash) |

## Деплой на Fly.io (актуальний, прод)

Єдиний образ: Evolution API + tg-worker + gateway + router (worker/fly/Dockerfile).

```bash
# 1. Один раз: додаток, Postgres, volume, секрети
fly apps create localchats-worker
fly postgres create --name localchats-db --region fra --vm-size shared-cpu-1x --volume-size 1
fly volumes create localchats_data --app localchats-worker --region fra --size 1 --yes
fly postgres attach localchats-db --app localchats-worker
fly secrets set --app localchats-worker \
  API_KEY=$(openssl rand -hex 32) \
  AUTHENTICATION_API_KEY=$(openssl rand -hex 32) \
  SESSION_ENCRYPTION_KEY=$(openssl rand -hex 32) \
  CLICK_HASH_SALT=$(openssl rand -hex 32) \
  CONSOLE_ORIGIN="https://<консоль>" SERVER_URL="https://localchats-worker.fly.dev"

# 2. Деплой (Postgres назви/регіон у fly.toml)
cd worker && fly deploy --app localchats-worker --config fly.toml
```

Публікатор образу Evolution: `docker.io/evoapicloud/evolution-api` (неймспейс
`atendai/...` більше не публікується). tg-worker стартує без TG-ключів
(`/tg/qr` → 503) — додати пізніше: `fly secrets set TG_API_ID=... TG_API_HASH=...`.

## Деплой на VPS (Ubuntu 24.04) — альтернатива

```bash
# 1. DNS: A-записи WORKER_HOST і GO_HOST → IP сервера
# 2. Docker
curl -fsSL https://get.docker.com | sh

# 3. Код
git clone <repo> && cd <repo>/worker

# 4. Секрети (НЕ комітити!)
cp .env.example .env
openssl rand -hex 32   # → API_KEY
openssl rand -hex 32   # → SESSION_ENCRYPTION_KEY
openssl rand -hex 32   # → CLICK_HASH_SALT
# TG_API_ID / TG_API_HASH → https://my.telegram.org → API development tools

# 5. Запуск
docker compose up -d --build
docker compose logs -f tg-worker   # переконатися, що healthcheck зелений
```

Далі в консолі: **Адмін → КОНЕКТОР: Воркер сесій** → `https://<WORKER_HOST>` + `API_KEY`
→ «Перевірити зв'язок» → активуйте режим ПРОДАКШЕН.

## Безпека (вбудовано в пакет)

- **Секрети тільки в `.env`** (у git не потрапляє — `worker/.gitignore`); у коді жодних
  ключів чи паролів; у логах — лише типи подій, без телефонів і тіл повідомлень.
- **Авторизація**: усі робочі ендпоінти вимагають `Authorization: Bearer <API_KEY>`,
  порівняння — `timingSafeEqual` (захист від timing-атак). Авторизація через заголовок,
  не cookies → CSRF не застосовний.
- **Шифрування сесій TG**: StringSession зберігається AES-256-GCM (`SESSION_ENCRYPTION_KEY`);
  файл `0600`, контейнер `read_only: true` + `no-new-privileges`, процес — непривілейований `node`.
- **Анти open-redirect**: gateway редиректить лише на allowlist-цілі (`t.me`, `wa.me`,
  `chat.whatsapp.com`, `api.whatsapp.com`, `viber://...`) — і при створенні, і при редиректі.
- **Приватність**: у БД кліків зберігаються лише `sha256(salt:ip)` та `sha256(salt:ua)` —
  сирі IP не зберігаються; `Referrer-Policy: no-referrer` на редиректі.
- **Rate limiting** на всіх ендпоінтах (in-memory, один інстанс) + обмеження тіл запитів
  (16–64 KB) + таймаути сервера.
- **Trust proxy = 1** (один хоп Caddy) — `req.ip` не спуфиться ззовні.
- Валідація вводу: `click_id` — строго Crockford base32 8; чат TG — `@handle` або 5–15 цифр;
  текст — до 4096 символів (ліміт Telegram).

## Обмеження фази 1

- `fallback`-атрібуція запрацює після фази 3 (ingest зіставляє `ip_hash/ua_hash` кліку
  з вхідним повідомленням). Поки кліки записуються, але не матчаться.
- **Вхідні повідомлення**: консоль опитує воркер кожні 15 с (WA — Evolution
  `POST /chat/findMessages/{instance}`, TG — `GET /tg/inbox?since=<ms>`), дедуп за
  `external_id`, вікно свіжості 30 хв. Це polling-режим: миттєва доставка вебхуками — фаза 3.
  ⚠️ Обмеження фази 1: `findMessages` підтягує **усі** останні 1:1-чати інстансу
  (не лише ліди з deep links) — особисті WA-чати теж створюють діалоги. Allowlist
  номерів або вебхук-ingest — фаза 3.
- **CORS**: консоль ходить на воркер з іншого origin — Caddy додає
  `Access-Control-Allow-Origin: $CONSOLE_ORIGIN` (заповніть у `.env`).
- Rate limiter in-memory — для кластера замінити на Redis.
