# Єдиний образ для Fly: Evolution API (lite) + tg-worker + gateway + router
# База — офіційний образ Evolution v2.3.7 (неймспейс evoapicloud — актуальний
# publisher; старий atendai/...-lite більше не публікується)
FROM docker.io/evoapicloud/evolution-api:v2.3.7

USER root
# better-sqlite3 (gateway) потребує нативної збірки на alpine
RUN apk add --no-cache python3 make g++ bash

# Baileys 7.0.0-rc.9 (у базовому образі v2.3.7) губить вхідні повідомлення
# від контактів із @lid-JID (не розшифровує їх; evolution-foundation#2582,
# #2638). Оновлюємо до rc14 — перевірений спільнотою фікс.
WORKDIR /evolution
RUN npm install baileys@7.0.0-rc14 --omit=dev --no-audit --no-fund

WORKDIR /services
COPY tg-worker/package.json tg-worker/package.json
COPY gateway/package.json gateway/package.json
RUN cd tg-worker && npm install --omit=dev --no-audit --no-fund \
 && cd ../gateway && npm install --omit=dev --no-audit --no-fund

COPY tg-worker/ tg-worker/
COPY gateway/ gateway/
COPY ingest/ ingest/
COPY fly/router.mjs fly/router.mjs
COPY fly/start.sh start.sh
# better-sqlite3: prebuild-install може принести glibc-бінарник на musl —
# форсуємо компіляцію з вихідників під поточний node/alpine
RUN cd gateway && npm rebuild better-sqlite3 --build-from-source
RUN chmod +x start.sh

ENV TG_DATA_DIR=/data/tg \
    GW_DATA_DIR=/data/gateway

# ENTRYPOINT оригінального образу (bash) виконає наш стартовий скрипт
ENTRYPOINT ["./start.sh"]
