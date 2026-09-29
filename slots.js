'use strict';
// Всё, что связано с датами и временными окнами. Единственный источник правды
// и для клиента (свободные слоты), и для владельца (расписание).

const pad = (n) => String(n).padStart(2, '0');
const toMin = (t) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
const toTime = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(str) {
  if (typeof str !== 'string' || !DATE_RE.test(str)) return false;
  const [y, m, d] = str.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function weekday(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = воскресенье
}

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Текущие дата и минуты с начала суток в часовом поясе сервиса.
function now(timeZone) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date());
  } catch {
    return now('UTC');
  }
  const get = (type) => parts.find((p) => p.type === type).value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

function isValidTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function daySlots(s) {
  const out = [];
  for (let m = toMin(s.workStart); m + s.slotMinutes <= toMin(s.workEnd); m += s.slotMinutes) out.push(toTime(m));
  return out;
}

function isWorkingDate(s, date) {
  return s.workDays.includes(weekday(date));
}

// Даты, доступные для записи: от сегодня на daysAhead дней вперёд.
function bookableDays(s) {
  const today = now(s.timezone).date;
  const out = [];
  for (let i = 0; i <= s.daysAhead; i += 1) {
    const date = addDays(today, i);
    out.push({ date, working: isWorkingDate(s, date) });
  }
  return out;
}

const isActive = (b) => b.status !== 'cancelled';

function countAt(bookings, date, time, exceptId) {
  return bookings.filter((b) => b.date === date && b.time === time && isActive(b) && b.id !== exceptId).length;
}

function isPast(s, date, time) {
  const n = now(s.timezone);
  if (date < n.date) return true;
  return date === n.date && toMin(time) < n.minutes + s.leadMinutes;
}

// Слоты для клиента: свободен ли каждый.
function slotsFor(s, bookings, date) {
  if (!isWorkingDate(s, date)) return [];
  return daySlots(s).map((time) => {
    const past = isPast(s, date, time);
    return { time, past, free: !past && countAt(bookings, date, time) < s.posts };
  });
}

// Можно ли записаться на дату/время (для проверки при создании записи).
function canBook(s, bookings, date, time) {
  const days = bookableDays(s);
  const day = days.find((d) => d.date === date);
  if (!day || !day.working) return false;
  const slot = slotsFor(s, bookings, date).find((x) => x.time === time);
  return Boolean(slot && slot.free);
}

module.exports = { toMin, toTime, isValidDate, weekday, addDays, now, isValidTimeZone, daySlots, isWorkingDate, bookableDays, slotsFor, canBook, countAt, isActive };
