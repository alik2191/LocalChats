FROM node:20-alpine

# better-sqlite3 потребує компіляції/бінарників
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev && npm cache clean --force

COPY src ./src

USER node

ENV NODE_ENV=production
EXPOSE 8788

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8788/healthz >/dev/null 2>&1 || exit 1

CMD ["node", "src/server.mjs"]
