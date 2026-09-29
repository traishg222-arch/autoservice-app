'use strict';
// Автотест API: запускает сервер на временной базе и проходит основные сценарии.
// Запуск: npm test
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'autoservice-'));
process.env.ADMIN_PASSWORD = 'test-pass-1';

const { server } = require('../server');
const slots = require('../lib/slots');
const store = require('../lib/store');

let base;
let passed = 0;
async function call(method, url, body, token) {
  const res = await fetch(base + url, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') || '';
  return { status: res.status, data: ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()), headers: res.headers };
}
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

server.listen(0, async () => {
  base = `http://127.0.0.1:${server.address().port}`;
  try {
    let token;
    let bookingId;
    const s = store.db.settings;
    // ближайший рабочий день, у которого есть свободное время
    const pub = (await call('GET', '/api/public')).data;
    const day = pub.days.find((d) => d.working && d.date > slots.now(s.timezone).date);
    const service = pub.services[0];

    await test('главная отдаёт услуги и настройки', async () => {
      assert.ok(pub.services.length >= 5);
      assert.equal(pub.settings.name, 'Гараж 24');
      assert.equal(pub.settings.passwordHash, undefined);
    });
    await test('слоты выходного дня пусты, рабочего — есть', async () => {
      const off = pub.days.find((d) => !d.working);
      if (off) assert.equal((await call('GET', `/api/slots?date=${off.date}`)).data.slots.length, 0);
      assert.equal((await call('GET', `/api/slots?date=${day.date}`)).data.slots.length, 10);
    });
    await test('запись создаётся, слот занимается по вместимости постов', async () => {
      const body = { serviceId: service.id, date: day.date, time: '10:00', name: 'Иван', phone: '+7 900 111-22-33', car: 'Kia Rio' };
      const r1 = await call('POST', '/api/bookings', body);
      assert.equal(r1.status, 200);
      bookingId = r1.data.booking.id;
      assert.equal((await call('POST', '/api/bookings', body)).status, 200); // второй пост
      const r3 = await call('POST', '/api/bookings', body);
      assert.equal(r3.status, 409); // постов всего 2
      const list = (await call('GET', `/api/slots?date=${day.date}`)).data.slots;
      assert.equal(list.find((x) => x.time === '10:00').free, false);
      assert.equal(list.find((x) => x.time === '11:00').free, true);
    });
    await test('валидация отклоняет плохие данные', async () => {
      const ok = { serviceId: service.id, date: day.date, time: '12:00', name: 'Иван', phone: '+7 900 111-22-33', car: 'Kia Rio' };
      for (const bad of [{ name: 'И' }, { phone: '123' }, { car: '' }, { time: '03:00' }, { time: '12:30' }, { serviceId: 'nope' }, { date: '2020-01-01' }]) {
        const r = await call('POST', '/api/bookings', { ...ok, ...bad });
        assert.ok(r.status >= 400 && r.status < 500, `должно быть отклонено: ${JSON.stringify(bad)}`);
      }
    });
    await test('админ-API закрыт без токена и с неверным паролем', async () => {
      assert.equal((await call('GET', '/api/admin/bookings')).status, 401);
      assert.equal((await call('GET', '/api/admin/bookings', null, 'x.y')).status, 401);
      assert.equal((await call('POST', '/api/admin/login', { password: 'wrong' })).status, 401);
      const ok = await call('POST', '/api/admin/login', { password: 'test-pass-1' });
      assert.equal(ok.status, 200);
      token = ok.data.token;
    });
    await test('владелец видит записи и меняет статус', async () => {
      const list = (await call('GET', '/api/admin/bookings', null, token)).data;
      assert.equal(list.bookings.length, 2);
      const r = await call('PATCH', `/api/admin/bookings/${bookingId}`, { status: 'confirmed' }, token);
      assert.equal(r.data.booking.status, 'confirmed');
      assert.equal((await call('PATCH', `/api/admin/bookings/${bookingId}`, { status: 'weird' }, token)).status, 400);
    });
    await test('отмена освобождает слот, восстановление при занятом — 409', async () => {
      await call('PATCH', `/api/admin/bookings/${bookingId}`, { status: 'cancelled' }, token);
      assert.equal((await call('GET', `/api/slots?date=${day.date}`)).data.slots.find((x) => x.time === '10:00').free, true);
      const body = { serviceId: service.id, date: day.date, time: '10:00', name: 'Пётр', phone: '89001112233', car: 'Lada' };
      assert.equal((await call('POST', '/api/bookings', body)).status, 200); // снова 2 активные
      assert.equal((await call('PATCH', `/api/admin/bookings/${bookingId}`, { status: 'new' }, token)).status, 409);
    });
    await test('расписание дня', async () => {
      const r = (await call('GET', `/api/admin/schedule?date=${day.date}`, null, token)).data;
      assert.equal(r.working, true);
      assert.equal(r.slots.find((x) => x.time === '10:00').bookings.length, 2);
    });
    await test('услуги: добавить, изменить цену, удалить; неактивные скрыты', async () => {
      const created = (await call('POST', '/api/admin/services', { name: 'Мойка', description: 'Бесконтактная', price: 500, duration: 20 }, token)).data.service;
      assert.equal((await call('GET', '/api/public')).data.services.some((x) => x.id === created.id), true);
      const upd = await call('PUT', `/api/admin/services/${created.id}`, { ...created, price: 700, active: false }, token);
      assert.equal(upd.data.service.price, 700);
      assert.equal((await call('GET', '/api/public')).data.services.some((x) => x.id === created.id), false);
      assert.equal((await call('POST', '/api/admin/services', { name: '', price: 1 }, token)).status, 400);
      assert.equal((await call('DELETE', `/api/admin/services/${created.id}`, null, token)).status, 200);
    });
    await test('настройки: название, цвета, часы; ошибки валидации', async () => {
      const r = await call('PUT', '/api/admin/settings', { name: 'Тест-Авто', primaryColor: '#22aa55', workEnd: '20:00' }, token);
      assert.equal(r.data.settings.name, 'Тест-Авто');
      const theme = (await call('GET', '/theme.css')).data.toString();
      assert.match(theme, /--primary:#22aa55/);
      const manifest = (await call('GET', '/manifest.webmanifest')).data;
      assert.equal(manifest.name, 'Тест-Авто');
      assert.equal((await call('PUT', '/api/admin/settings', { primaryColor: 'red' }, token)).status, 400);
      assert.equal((await call('PUT', '/api/admin/settings', { workStart: '20:00', workEnd: '09:00' }, token)).status, 400);
      assert.equal((await call('PUT', '/api/admin/settings', { timezone: 'Mars/Base' }, token)).status, 400);
    });
    await test('иконки: по умолчанию сгенерированный PNG', async () => {
      for (const size of [192, 512]) {
        const r = await call('GET', `/icons/icon-${size}.png`);
        assert.equal(r.status, 200);
        assert.equal(r.headers.get('content-type'), 'image/png');
        assert.equal(r.data.subarray(1, 4).toString(), 'PNG');
      }
    });
    await test('логотип: загрузка и сброс', async () => {
      const png = (await call('GET', '/icons/icon-192.png')).data.toString('base64');
      const up = await call('PUT', '/api/admin/logo', { png192: png, png512: png }, token);
      assert.ok(up.data.logoVersion > 0);
      assert.equal((await call('PUT', '/api/admin/logo', { png192: 'abc', png512: 'abc' }, token)).status, 400);
      assert.equal((await call('DELETE', '/api/admin/logo', null, token)).data.logoVersion, 0);
    });
    await test('смена пароля завершает старые сессии', async () => {
      assert.equal((await call('POST', '/api/admin/password', { current: 'bad', next: 'newpass1' }, token)).status, 403);
      const r = await call('POST', '/api/admin/password', { current: 'test-pass-1', next: 'newpass1' }, token);
      assert.equal(r.status, 200);
      assert.equal((await call('GET', '/api/admin/bookings', null, token)).status, 401);
      assert.equal((await call('GET', '/api/admin/bookings', null, r.data.token)).status, 200);
    });
    await test('статика и защита от выхода из каталога', async () => {
      assert.equal((await call('GET', '/')).status, 200);
      assert.equal((await call('GET', '/admin')).status, 200);
      assert.equal((await call('GET', '/sw.js')).status, 200);
      assert.equal((await call('GET', '/..%2fserver.js')).status, 403);
      assert.equal((await call('GET', '/nope.js')).status, 404);
    });
    console.log(`\nВсе проверки пройдены: ${passed}`);
    server.close();
    fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
    process.exit(0);
  } catch (e) {
    console.error('\nОШИБКА ТЕСТА:', e);
    process.exit(1);
  }
});
