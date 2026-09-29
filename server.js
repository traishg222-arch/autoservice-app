'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const store = require('./lib/store');
const auth = require('./lib/auth');
const slots = require('./lib/slots');
const v = require('./lib/validate');
const { wheelIcon } = require('./lib/icon');
const { HttpError, bad } = require('./lib/errors');

store.load();

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const STATUSES = ['new', 'confirmed', 'done', 'cancelled'];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};

const loginLimiter = auth.createLimiter(10, 15 * 60 * 1000); // 10 попыток / 15 минут
const bookingLimiter = auth.createLimiter(15, 60 * 60 * 1000); // 15 записей в час с одного IP

/* ---------- Вспомогательное ---------- */

const settings = () => store.db.settings;
const clientIp = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body) || typeof body === 'string';
  res.writeHead(status, {
    ...(isBuf ? {} : { 'Content-Type': 'application/json; charset=utf-8' }),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(isBuf ? body : JSON.stringify(body));
}

function readJson(req, limit = 1_500_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'Слишком большой запрос'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(bad('Некорректный JSON'));
      }
    });
    req.on('error', reject);
  });
}

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const inkOn = (hex) => (lum(hex) > 0.35 ? '#10222a' : '#ffffff');

const publicSettings = () => {
  const { name, tagline, phone, address, primaryColor, darkColor, currency, workStart, workEnd, workDays, slotMinutes, logoVersion } = settings();
  return { name, tagline, phone, address, primaryColor, darkColor, currency, workStart, workEnd, workDays, slotMinutes, logoVersion };
};

const publicBooking = (b) => ({ id: b.id, serviceName: b.serviceName, price: b.price, priceFrom: b.priceFrom, date: b.date, time: b.time, name: b.name, phone: b.phone, car: b.car, status: b.status });

function notify(text) {
  const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chat } = process.env;
  if (!token || !chat) return;
  fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text }),
  }).catch((e) => console.error('Telegram:', e.message));
}

function findService(id) {
  return store.db.services.find((s) => s.id === id);
}

function findBooking(id) {
  const b = store.db.bookings.find((x) => x.id === id);
  if (!b) throw new HttpError(404, 'Запись не найдена');
  return b;
}

/* ---------- Маршруты ---------- */

const routes = [];
const add = (method, pattern, handler, isAdmin = false) => {
  routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), handler, isAdmin });
};

// --- Клиент ---
add('GET', '/api/public', () => ({
  settings: publicSettings(),
  services: store.db.services.filter((s) => s.active).map(({ id, name, description, price, priceFrom, duration }) => ({ id, name, description, price, priceFrom, duration })),
  days: slots.bookableDays(settings()),
}));

add('GET', '/api/slots', ({ url }) => {
  const date = url.searchParams.get('date');
  if (!slots.isValidDate(date)) throw bad('Неверная дата');
  const inRange = slots.bookableDays(settings()).some((d) => d.date === date);
  return { date, slots: inRange ? slots.slotsFor(settings(), store.db.bookings, date) : [] };
});

add('POST', '/api/bookings', async ({ req }) => {
  if (!bookingLimiter(clientIp(req))) throw new HttpError(429, 'Слишком много заявок. Попробуйте позже или позвоните нам.');
  const body = await readJson(req);
  const service = findService(body.serviceId);
  if (!service || !service.active) throw bad('Услуга недоступна');
  const data = {
    name: v.str(body.name, 2, 60, 'Имя'),
    phone: v.phone(body.phone),
    car: v.str(body.car, 2, 60, 'Автомобиль'),
  };
  if (!slots.isValidDate(body.date) || typeof body.time !== 'string') throw bad('Выберите дату и время');
  if (!slots.canBook(settings(), store.db.bookings, body.date, body.time)) {
    throw new HttpError(409, 'Это время уже занято. Выберите другое.');
  }
  const booking = {
    id: store.uid(),
    serviceId: service.id,
    serviceName: service.name,
    price: service.price,
    priceFrom: service.priceFrom,
    date: body.date,
    time: body.time,
    ...data,
    status: 'new',
    createdAt: new Date().toISOString(),
  };
  store.db.bookings.push(booking);
  store.save();
  notify(`Новая запись: ${booking.serviceName}\n${booking.date} ${booking.time}\n${booking.name}, ${booking.phone}\n${booking.car}`);
  return { booking: publicBooking(booking) };
});

// --- Авторизация ---
add('POST', '/api/admin/login', async ({ req }) => {
  if (!loginLimiter(clientIp(req))) throw new HttpError(429, 'Слишком много попыток входа. Подождите 15 минут.');
  const body = await readJson(req);
  if (!auth.verifyPassword(body.password, store.db.admin)) throw new HttpError(401, 'Неверный пароль');
  return { token: auth.issueToken(store.db.secret, store.db.admin) };
});

// --- Владелец: записи ---
add('GET', '/api/admin/bookings', () => ({
  today: slots.now(settings().timezone).date,
  bookings: [...store.db.bookings].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)),
}), true);

add('PATCH', '/api/admin/bookings/:id', async ({ req, params }) => {
  const b = findBooking(params.id);
  const { status } = await readJson(req);
  if (!STATUSES.includes(status)) throw bad('Неизвестный статус');
  if (b.status === 'cancelled' && status !== 'cancelled' && slots.countAt(store.db.bookings, b.date, b.time, b.id) >= settings().posts) {
    throw new HttpError(409, 'Нельзя восстановить: это время уже занято другими записями');
  }
  b.status = status;
  store.save();
  return { booking: b };
}, true);

add('DELETE', '/api/admin/bookings/:id', ({ params }) => {
  const b = findBooking(params.id);
  store.db.bookings = store.db.bookings.filter((x) => x !== b);
  store.save();
  return { ok: true };
}, true);

add('GET', '/api/admin/schedule', ({ url }) => {
  const date = url.searchParams.get('date');
  if (!slots.isValidDate(date)) throw bad('Неверная дата');
  const s = settings();
  const working = slots.isWorkingDate(s, date);
  const day = store.db.bookings.filter((b) => b.date === date && slots.isActive(b));
  const times = new Set(working ? slots.daySlots(s) : []);
  day.forEach((b) => times.add(b.time)); // записи вне текущей сетки не теряем
  return {
    date,
    working,
    posts: s.posts,
    slots: [...times].sort().map((time) => ({ time, bookings: day.filter((b) => b.time === time) })),
  };
}, true);

// --- Владелец: услуги ---
add('GET', '/api/admin/services', () => ({ services: store.db.services }), true);

add('POST', '/api/admin/services', async ({ req }) => {
  const service = { id: store.uid(), ...v.cleanService(await readJson(req)) };
  store.db.services.push(service);
  store.save();
  return { service };
}, true);

add('PUT', '/api/admin/services/:id', async ({ req, params }) => {
  const service = findService(params.id);
  if (!service) throw new HttpError(404, 'Услуга не найдена');
  Object.assign(service, v.cleanService(await readJson(req)));
  store.save();
  return { service };
}, true);

add('DELETE', '/api/admin/services/:id', ({ params }) => {
  const service = findService(params.id);
  if (!service) throw new HttpError(404, 'Услуга не найдена');
  store.db.services = store.db.services.filter((s) => s !== service);
  store.save();
  return { ok: true };
}, true);

// --- Владелец: настройки, логотип, пароль ---
add('GET', '/api/admin/settings', () => ({ settings: settings() }), true);

add('PUT', '/api/admin/settings', async ({ req }) => {
  store.db.settings = v.cleanSettings(await readJson(req), settings());
  store.save();
  return { settings: settings() };
}, true);

const logoFile = (size) => path.join(store.DATA_DIR, `logo-${size}.png`);
const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

add('PUT', '/api/admin/logo', async ({ req }) => {
  const body = await readJson(req, 2_000_000);
  const decoded = {};
  for (const size of [192, 512]) {
    const raw = String(body[`png${size}`] || '').replace(/^data:image\/png;base64,/, '');
    const buf = Buffer.from(raw, 'base64');
    if (buf.length < 100 || buf.length > 600_000 || !buf.subarray(0, 8).equals(PNG_SIG)) throw bad('Логотип должен быть PNG-изображением');
    decoded[size] = buf;
  }
  fs.writeFileSync(logoFile(192), decoded[192]);
  fs.writeFileSync(logoFile(512), decoded[512]);
  settings().logoVersion = Date.now();
  store.save();
  return { logoVersion: settings().logoVersion };
}, true);

add('DELETE', '/api/admin/logo', () => {
  for (const size of [192, 512]) fs.rmSync(logoFile(size), { force: true });
  settings().logoVersion = 0;
  store.save();
  return { logoVersion: 0 };
}, true);

add('POST', '/api/admin/password', async ({ req }) => {
  const { current, next } = await readJson(req);
  if (!auth.verifyPassword(current, store.db.admin)) throw new HttpError(403, 'Текущий пароль указан неверно');
  if (typeof next !== 'string' || next.length < 6 || next.length > 100) throw bad('Новый пароль: от 6 символов');
  store.db.admin = auth.createPassword(next);
  store.save();
  return { token: auth.issueToken(store.db.secret, store.db.admin) };
}, true);

// --- Динамические файлы брендинга ---
const iconKey = () => `${settings().logoVersion}-${settings().primaryColor.slice(1)}-${settings().darkColor.slice(1)}`;

add('GET', '/manifest.webmanifest', () => {
  const s = settings();
  const custom = s.logoVersion > 0;
  const icon = (size) => ({ src: `/icons/icon-${size}.png?v=${iconKey()}`, sizes: `${size}x${size}`, type: 'image/png', purpose: custom ? 'any' : 'any maskable' });
  return Buffer.from(JSON.stringify({
    name: s.name,
    short_name: s.name.length > 12 ? s.name.slice(0, 12).trim() : s.name,
    description: s.tagline || `Онлайн-запись в ${s.name}`,
    lang: 'ru',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: s.darkColor,
    theme_color: s.darkColor,
    icons: [icon(192), icon(512)],
  }));
});

add('GET', '/theme.css', () => {
  const s = settings();
  return Buffer.from(`:root{--primary:${s.primaryColor};--on-primary:${inkOn(s.primaryColor)};--dark:${s.darkColor};}\n`);
});

add('GET', '/icons/icon-:size.png', ({ params }) => {
  const size = Number(params.size);
  if (size !== 192 && size !== 512) throw new HttpError(404, 'Не найдено');
  const s = settings();
  if (s.logoVersion > 0 && fs.existsSync(logoFile(size))) return fs.readFileSync(logoFile(size));
  return wheelIcon(size, s.primaryColor, s.darkColor);
});

const DYNAMIC_TYPES = { '/manifest.webmanifest': MIME['.webmanifest'], '/theme.css': MIME['.css'] };

/* ---------- Статика ---------- */

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname === '/admin' ? 'admin.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.resolve(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, { error: 'Запрещено' });
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return send(res, 404, { error: 'Не найдено' });
  }
  if (!stat.isFile()) return send(res, 404, { error: 'Не найдено' });
  const etag = `W/"${stat.size}-${Math.floor(stat.mtimeMs)}"`;
  const headers = { ETag: etag, 'Cache-Control': 'no-cache' };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  res.writeHead(200, { ...headers, 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Content-Length': stat.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

/* ---------- Сервер ---------- */

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

const server = http.createServer(async (req, res) => {
  for (const [k, val] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, val);
  try {
    const url = new URL(req.url, 'http://localhost');
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    for (const r of routes) {
      const m = r.re.exec(url.pathname);
      if (!m || r.method !== method) continue;
      if (r.isAdmin) {
        const token = (req.headers.authorization || '').replace(/^Bearer /, '');
        if (!auth.verifyToken(store.db.secret, store.db.admin, token)) throw new HttpError(401, 'Требуется вход');
      }
      const out = await r.handler({ req, url, params: m.groups || {} });
      if (Buffer.isBuffer(out)) {
        const isPng = url.pathname.endsWith('.png');
        return send(res, 200, out, {
          'Content-Type': isPng ? 'image/png' : DYNAMIC_TYPES[url.pathname],
          'Cache-Control': isPng ? 'public, max-age=86400' : 'no-cache',
        });
      }
      return send(res, 200, out);
    }
    if (url.pathname.startsWith('/api/')) throw new HttpError(404, 'Не найдено');
    if (method !== 'GET') throw new HttpError(405, 'Метод не поддерживается');
    return serveStatic(req, res, url.pathname);
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message });
    console.error(e);
    return send(res, 500, { error: 'Внутренняя ошибка сервера' });
  }
});

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Сервер запущен: http://localhost:${PORT}  (панель владельца: /admin)`);
    if (auth.verifyPassword('admin123', store.db.admin)) {
      console.warn('ВНИМАНИЕ: используется пароль по умолчанию «admin123». Смените его в панели: Настройки → Безопасность.');
    }
  });
}

module.exports = { server };
