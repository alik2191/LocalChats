#!/bin/bash
# Старт усіх сервісів в одному контейнері Fly:
# Evolution API (WA) -> tg-worker (Telegram) -> gateway (deep links) -> router
set -e

echo "[start] evolution: міграції + запуск"
cd /evolution
# Postgres у Fly може підніматися пізніше контейнера — чекаємо з ретраями
n=0
until bash ./Docker/scripts/deploy_database.sh; do
  n=$((n+1))
  if [ "$n" -ge 10 ]; then
    echo "[start] evolution: міграції не вдалися після 10 спроб" >&2
    exit 1
  fi
  echo "[start] evolution: чекаю на БД (спроба $n)"
  sleep 4
done
npm run start:prod &
echo "[start] evolution запущено"

echo "[start] tg-worker"
cd /services/tg-worker
exec_node() { node "$1" & }

exec_node src/server.mjs

echo "[start] gateway"
cd /services/gateway
exec_node src/server.mjs

echo "[start] router (основний процес)"
cd /services
exec node fly/router.mjs
