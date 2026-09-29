// Общие утилиты интерфейса: построение DOM, иконки, форматирование.

const BOOL_PROPS = new Set(['value', 'checked', 'selected', 'disabled', 'hidden']);

// h('div', { class: 'x', onClick: fn }, 'текст', h('span'))
// Текст всегда вставляется как текстовый узел, поэтому XSS через данные невозможен.
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, val] of Object.entries(attrs || {})) {
    if (val == null || val === false) continue;
    if (key === 'class') el.className = val;
    else if (key.startsWith('on') && typeof val === 'function') el.addEventListener(key.slice(2).toLowerCase(), val);
    else if (BOOL_PROPS.has(key)) el[key] = val;
    else el.setAttribute(key, val === true ? '' : val);
  }
  append(el, children);
  return el;
}

// Замена содержимого. В отличие от нативного replaceChildren, разворачивает массивы
// и пропускает null/false (иначе в интерфейсе появились бы тексты «false» и «[object …]»).
export function mount(el, ...children) {
  el.replaceChildren();
  append(el, children);
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

const ICONS = {
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  car: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0z"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/>',
};

export function icon(name, size = 20) {
  const t = document.createElement('template');
  t.innerHTML = `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  return t.content.firstChild;
}

/* ---------- Форматирование ---------- */

export const fmtPrice = (n, currency, from = false) => `${from ? 'от ' : ''}${Number(n).toLocaleString('ru-RU')}\u00a0${currency}`;

export function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const fmtDate = (str, opts) => new Intl.DateTimeFormat('ru-RU', opts).format(parseDate(str));
export const fmtDateLong = (str) => fmtDate(str, { weekday: 'long', day: 'numeric', month: 'long' });

export function addDays(str, n) {
  const d = parseDate(str);
  d.setDate(d.getDate() + n);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
export const DAY_NAMES = { 1: 'Пн', 2: 'Вт', 3: 'Ср', 4: 'Чт', 5: 'Пт', 6: 'Сб', 0: 'Вс' };

// [1,2,3,4,5,6] -> "Пн–Сб", [1,3] -> "Пн, Ср"
export function workDaysText(days) {
  const set = new Set(days);
  if (set.size === 7) return 'Ежедневно';
  const groups = [];
  let run = [];
  for (const d of DAY_ORDER) {
    if (set.has(d)) run.push(d);
    else if (run.length) { groups.push(run); run = []; }
  }
  if (run.length) groups.push(run);
  return groups
    .map((g) => (g.length === 1 ? DAY_NAMES[g[0]] : g.length === 2 ? `${DAY_NAMES[g[0]]}, ${DAY_NAMES[g[1]]}` : `${DAY_NAMES[g[0]]}–${DAY_NAMES[g[g.length - 1]]}`))
    .join(', ');
}

export const iconUrl = (s, size = 192) => `/icons/icon-${size}.png?v=${s.logoVersion}-${s.primaryColor.slice(1)}-${s.darkColor.slice(1)}`;

/* ---------- Прочее ---------- */

export function toast(message, kind = 'info') {
  const el = h('div', { class: `toast toast-${kind}`, role: 'status' }, message);
  document.body.append(el);
  setTimeout(() => el.classList.add('toast-out'), 3200);
  setTimeout(() => el.remove(), 3600);
}

export function setThemeColor(color) {
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = h('meta', { name: 'theme-color' });
    document.head.append(meta);
  }
  meta.setAttribute('content', color);
}

export function registerSW() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
}

export const spinner = () => h('div', { class: 'spinner', role: 'progressbar', 'aria-label': 'Загрузка' });
