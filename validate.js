'use strict';
const { bad } = require('./errors');
const slots = require('./slots');

const COLOR_RE = /^#[0-9a-f]{6}$/i;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Убираем управляющие символы и лишние пробелы. Экранирование HTML делает
// интерфейс (текст вставляется через textContent), здесь — только чистка.
function str(value, min, max, label) {
  if (typeof value !== 'string') throw bad(`Поле «${label}» заполнено неверно`);
  const v = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (v.length < min) throw bad(min === 1 ? `Заполните поле «${label}»` : `Поле «${label}» слишком короткое`);
  if (v.length > max) throw bad(`Поле «${label}» слишком длинное (максимум ${max})`);
  return v;
}

function int(value, min, max, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`«${label}»: введите целое число от ${min} до ${max}`);
  return n;
}

function phone(value) {
  const v = str(value, 1, 30, 'Телефон').replace(/[^\d+]/g, '');
  const digits = v.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) throw bad('Введите корректный номер телефона');
  return v;
}

const SETTINGS_RULES = {
  name: (v) => str(v, 1, 60, 'Название'),
  tagline: (v) => str(v, 0, 120, 'Слоган'),
  phone: (v) => str(v, 0, 30, 'Телефон'),
  address: (v) => str(v, 0, 120, 'Адрес'),
  primaryColor: (v) => {
    if (!COLOR_RE.test(v)) throw bad('Основной цвет должен быть в формате #rrggbb');
    return v.toLowerCase();
  },
  darkColor: (v) => {
    if (!COLOR_RE.test(v)) throw bad('Тёмный цвет должен быть в формате #rrggbb');
    return v.toLowerCase();
  },
  currency: (v) => str(v, 1, 5, 'Валюта'),
  timezone: (v) => {
    if (!slots.isValidTimeZone(v)) throw bad('Неизвестный часовой пояс');
    return v;
  },
  workStart: (v) => {
    if (!TIME_RE.test(v)) throw bad('Время начала: формат ЧЧ:ММ');
    return v;
  },
  workEnd: (v) => {
    if (!TIME_RE.test(v)) throw bad('Время окончания: формат ЧЧ:ММ');
    return v;
  },
  slotMinutes: (v) => int(v, 15, 480, 'Длина окна, мин'),
  posts: (v) => int(v, 1, 30, 'Количество постов'),
  daysAhead: (v) => int(v, 1, 90, 'Запись на дней вперёд'),
  leadMinutes: (v) => int(v, 0, 2880, 'Запись не позднее чем за, мин'),
  workDays: (v) => {
    if (!Array.isArray(v) || !v.length) throw bad('Выберите хотя бы один рабочий день');
    const days = [...new Set(v.map(Number))];
    if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw bad('Неверные рабочие дни');
    return days.sort();
  },
};

function cleanSettings(input, current) {
  const next = { ...current };
  for (const [key, rule] of Object.entries(SETTINGS_RULES)) {
    if (key in input) next[key] = rule(input[key]);
  }
  if (slots.toMin(next.workEnd) <= slots.toMin(next.workStart) || !slots.daySlots(next).length) {
    throw bad('Рабочее время задано неверно: в него не помещается ни одно окно записи');
  }
  return next;
}

function cleanService(input) {
  if (typeof input !== 'object' || input === null) throw bad('Неверные данные услуги');
  return {
    name: str(input.name, 1, 80, 'Название услуги'),
    description: str(input.description ?? '', 0, 300, 'Описание'),
    price: int(input.price, 0, 10_000_000, 'Цена'),
    priceFrom: Boolean(input.priceFrom),
    duration: int(input.duration ?? 60, 5, 1440, 'Длительность'),
    active: input.active !== false,
  };
}

module.exports = { str, int, phone, cleanSettings, cleanService };
