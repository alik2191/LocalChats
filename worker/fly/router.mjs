// Єдиний вхідний роутер Fly: один домен -> три сервіси
//   /tg/*      -> tg-worker        (8787)
//   /c/*       -> gateway          (8788)
//   інше       -> Evolution API    (8080)
// CORS: консоль ходить з іншого origin — додаємо заголовки тут
import http from 'node:http';

const PORT = Number(process.env.PORT || 8081);
const EVOLUTION = { host: '127.0.0.1', port: 8080 };
const TG = { host: '127.0.0.1', port: 8787 };
const GW = { host: '127.0.0.1', port: 8788 };
const INGEST = { host: '127.0.0.1', port: 8082 };
const CORS_ORIGIN = process.env.CONSOLE_ORIGIN || '*';
// Додаткові дозволені origin (через кому): локальна розробка/тестування
const CORS_EXTRA = (process.env.CORS_EXTRA_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const ALLOWED_ORIGINS = new Set([CORS_ORIGIN, ...CORS_EXTRA]);

function allowedOrigin(origin) {
  if (!CORS_ORIGIN || CORS_ORIGIN === '*') return '*';
  return ALLOWED_ORIGINS.has(origin) ? origin : CORS_ORIGIN;
}

function upstream(pathname) {
  if (pathname === '/tg' || pathname.startsWith('/tg/')) return TG;
  if (pathname === '/c' || pathname.startsWith('/c/') || pathname === '/clicks') return GW;
  if (pathname === '/ingest' || pathname.startsWith('/ingest/')) return INGEST;
  return EVOLUTION;
}

function applyCors(res, origin) {
  const allow = allowedOrigin(origin);
  res.setHeader('Access-Control-Allow-Origin', allow);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, apikey');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  // Прибрати CORS-заголовки апстрімів, щоб не дублювались
  const stale = res.getHeader('access-control-allow-origin');
  if (stale && stale !== allow) res.setHeader('Access-Control-Allow-Origin', allow);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://internal');

  if (req.method === 'OPTIONS') {
    applyCors(res, req.headers.origin);
    res.writeHead(204);
    return res.end();
  }

  if (url.pathname === '/healthz') {
    applyCors(res, req.headers.origin);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, service: 'router' }));
  }

  const target = upstream(url.pathname);
  const proxied = http.request(
    {
      host: target.host,
      port: target.port,
      path: url.pathname + url.search,
      method: req.method,
      headers: { ...req.headers, host: `${target.host}:${target.port}` },
    },
    (up) => {
      applyCors(res, req.headers.origin);
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  proxied.on('error', (e) => {
    applyCors(res, req.headers.origin);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'upstream unavailable', detail: e.code ?? 'unknown' }));
  });
  req.pipe(proxied);
});

server.listen(PORT, () => console.log(`router on :${PORT}`));
