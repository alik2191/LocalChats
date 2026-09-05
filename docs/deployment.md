# Розгортання: що потрібно для повного запуску в проді

Цей документ — конкретний план інфраструктури, щоб вивести LocalChats з демо в реальний
продакшен. Демо працює без жодного з цих ресурсів; у проді **обов'язковий лише блок 2
(воркер сесій)**, решта додається поступово.

## 1. Домен і deep link-редирект

| Ресурс | Приклад | Навіщо |
|---|---|---|
| Домен | `meridian.ua` (бюджет ~$10–15/рік) | Бренд у посиланнях і пошті |
| Піддомен консолі | `app.meridian.ua` → Verdent-деплой (CNAME) | Адреса Sales Console |
| Піддомен редиректу | `go.meridian.ua` | Приймає клік `https://go.meridian.ua/c/A7K2M9QX`, пише `clicks` (ip_hash, ua_hash, utm, gclid) і 302 на `wa.me`/`t.me`/`viber://` |
| TLS | Cloudflare (Free) або Caddy на воркері | HTTPS обов'язковий: консоль працює по https, http-ресурси браузер блокує (mixed content) |

Редирект — це ~40 рядків: Edge Function на Supabase або той самий воркер (ендпоінт
`GET /c/:click_id`). Без нього працює атрибуція `exact` (метка в тексті), але `fallback`
(матчинг за IP+UA) не спрацює ніколи.

## 2. Воркер сесій — єдиний обов'язковий компонент

> **Готовий пакет:** `worker/` у репозиторії — `docker-compose.yml` (Evolution API +
> gramjs tg-worker + gateway для deep links + Caddy), `.env.example`, runbook у
> `worker/README.md`. Деплой зводиться до: DNS → `cp .env.example .env` → заповнити
> секрети → `docker compose up -d --build`.

Тримає WhatsApp/Telegram-сесії (браузер цього робити не вміє). Один невеликий сервер:

| Ресурс | Приклад | Орієнтир ціни |
|---|---|---|
| VPS | Hetzner CX22 (2 vCPU / 4 GB, Ubuntu 24.04) або Fly.io `shared-cpu-1x` / 1 GB | €3.79–8/міс ($5–10) |
| Docker | `docker compose` з двома сервісами | — |
| Домен воркера | `worker.meridian.ua` → A-запис на VPS | — |
| TLS | Caddy (авто-сертифікат Let's Encrypt) або Cloudflare | безкоштовно |

Склад воркера:

```yaml
# docker-compose.yml (VPS)
services:
  evolution:                      # WhatsApp (Baileys під капотом)
    image: attenioltd/evolution-api:latest
    restart: unless-stopped
    environment:
      - AUTHENTICATION_API_KEY=<довгий-випадковий-секрет>
      - DATABASE_ENABLED=false    # сесії у volume — достатньо для старту
    volumes:
      - evolution_instances:/evolution/instances
  caddy:                          # TLS + reverse proxy
    image: caddy:2
    restart: unless-stopped
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
volumes: { evolution_instances: {}, caddy_data: {} }
```

```
# Caddyfile
worker.meridian.ua {
  reverse_proxy evolution:8080
}
```

Telegram-особисті: ще один контейнер з gramjs-сервісом, який реалізує контракт
`/tg/qr`, `/tg/status`, `/tg/send` (див. `src/lib/worker.ts`). Готовий шаблон можно
згенерувати за запитом.

Перевірки після запуску:

```bash
curl https://worker.meridian.ua/  # має відповісти Evolution API
```

Потім у застосунку: **Адмін → КОНЕКТОР: Воркер сесій** → `https://worker.meridian.ua`
+ `AUTHENTICATION_API_KEY` → «Перевірити зв'язок» → зелений статус → режим «ПРОДАКШЕН»
станеться доступним → підключення номерів за QR.

**Вимоги безпеки:** секрет тільки в env воркера (ніколи в git); сесії Evolution у volume;
для масових сценаріїв — окремі SIM-картки під кожен канал і прогрів 2–3 тижні; режим
inbound-only (у застосунку це зашито).

## 3. Supabase (хмарний стан)

Зараз керується Verdent — окремий акаунт не потрібен. Якщо виносите самостійно:

| Ресурс | Приклад | Ціна |
|---|---|---|
| Проєкт Supabase | `localchats.supabase.co`, регіон eu-central-1 | Free → Pro $25/міс |
| Схема | `supabase/schema.sql` (міграції) | — |
| Realtime | publication для messages/conversations | включено |

Мінімум, який уже застосовано: таблиця `app_state` з RLS (`user_id = auth.uid()`).

## 4. Telegram-бот і Viber (официальные бесплатные каналы)

| Ресурс | Дії | Ціна |
|---|---|---|
| Telegram-бот | @BotFather → `/newbot` → токен → `setWebhook` з `secret_token` на бекенд | безкоштовно |
| Viber PA | partners.viber.com → Public Account → webhook URL | безкоштовно |
| WhatsApp Cloud API | Meta Business → App → permanent token + verify webhook | безкоштовно inbound |

Ці канали не потребують воркера і не мають ризику бану — їх можна підключати паралельно
з особистими номерами.

## 5. Zoho CRM + Google Ads (етап 2)

| Ресурс | Приклад | Ціна |
|---|---|---|
| Zoho CRM | Free (до 3 користувачів) → Standard $14/користувач/міс, DC `zoho.eu` | $0–14+ |
| OAuth | api-console.zoho.eu → Self Client → refresh_token у env бекенда | — |
| Google Ads API | offline-конверсії за gclid (потрібен dev token) | безкоштовно |

## Бюджет мінімального запуску

| Стаття | Сума |
|---|---|
| VPS воркера (Hetzner CX22) | €3.79/міс |
| Домен | ~$1/міс (амортизація) |
| TLS (Let's Encrypt / Cloudflare) | $0 |
| Supabase (Verdent-managed) | $0 |
| Telegram-бот / Viber PA / WA Cloud inbound | $0 |
| **Разом** | **~$5–6/міс** |

## Чек-лист запуску

1. [ ] VPS орендовано, Docker встановлено, домен `worker.meridian.ua` → A-запис
2. [ ] `docker compose up -d` (Evolution + Caddy), TLS видано
3. [ ] В адмінці: URL + ключ воркера → «Перевірити зв'язок» → OK
4. [ ] Режим ПРОДАКШЕН активовано, робочі номери підключено за QR
5. [ ] `go.meridian.ua/c/:click_id` редирект задеплоєний (для fallback-атрібуції)
6. [ ] Deep links на лендингу обгорнуті в `go.meridian.ua/c/...`
7. [ ] Тест: клік з метки → повідомлення в мессенджері → діалог у консолі з атрибуцією EXACT
8. [ ] Інструкція команді: inbound-only, розсилок немає, «стоп» — на першу просьбу
