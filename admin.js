import { api } from './api.js';
import { h, mount, icon, spinner, fmtPrice, fmtDate, addDays, DAY_NAMES, iconUrl, toast, setThemeColor, registerSW } from './ui.js';

const app = document.getElementById('app');

const STATUS = { new: 'Новая', confirmed: 'Подтверждена', done: 'Выполнена', cancelled: 'Отменена' };
const STATUS_SHORT = { new: 'Новая', confirmed: 'Подтв.', done: 'Готово', cancelled: 'Отмена' };
const STATUS_KEYS = Object.keys(STATUS);
const TABS = [
  { id: 'bookings', label: 'Записи', icon: 'list' },
  { id: 'schedule', label: 'Расписание', icon: 'calendar' },
  { id: 'services', label: 'Услуги', icon: 'wrench' },
  { id: 'settings', label: 'Настройки', icon: 'sliders' },
];
const WEEK = [1, 2, 3, 4, 5, 6, 0];

const S = {
  token: localStorage.getItem('adm_token'),
  tab: 'bookings',
  filter: null,
  schedDate: null,
  bookings: [],
  today: '',
  services: [],
  settings: null,
  main: null,
  tabbar: null,
  timer: null,
  closeSheet: null,
};

/* ---------- Запросы ---------- */

async function call(path, opts = {}) {
  try {
    return await api(path, { ...opts, token: S.token });
  } catch (err) {
    if (err.status === 401 && S.token) logout('Сессия истекла. Войдите снова.');
    throw err;
  }
}

function logout(message) {
  localStorage.removeItem('adm_token');
  S.token = null;
  clearInterval(S.timer);
  S.closeSheet?.();
  showLogin(message);
}

/* ---------- Вход ---------- */

async function showLogin(message) {
  let brand = { name: 'Автосервис', logoVersion: 0, primaryColor: '#ffc400', darkColor: '#0f2a33' };
  try {
    brand = (await api('/api/public')).settings;
  } catch { /* без брендинга */ }

  const err = h('div', { class: 'form-error', hidden: !message, role: 'alert' }, message || '');
  const pw = h('input', { class: 'input', id: 'pw', type: 'password', autocomplete: 'current-password', placeholder: 'Пароль', required: true });
  const btn = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Войти');

  const form = h('form', {
    class: 'login-card',
    onSubmit: async (e) => {
      e.preventDefault();
      err.hidden = true;
      btn.disabled = true;
      try {
        const { token } = await api('/api/admin/login', { method: 'POST', body: { password: pw.value } });
        S.token = token;
        localStorage.setItem('adm_token', token);
        boot();
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
        btn.disabled = false;
        pw.select();
      }
    },
  },
  h('img', { src: iconUrl(brand), alt: '' }),
  h('h1', null, 'Панель владельца'),
  h('p', { class: 'sub' }, brand.name),
  err,
  h('div', { class: 'field' }, h('label', { for: 'pw' }, 'Пароль'), pw),
  btn);

  document.title = 'Вход: панель владельца';
  mount(app, h('div', { class: 'login' }, form));
  pw.focus();
}

/* ---------- Загрузка и каркас ---------- */

async function boot() {
  mount(app, h('div', { class: 'splash' }, spinner()));
  try {
    const [b, sv, st] = await Promise.all([
      call('/api/admin/bookings'), call('/api/admin/services'), call('/api/admin/settings'),
    ]);
    S.bookings = b.bookings;
    S.today = b.today;
    S.services = sv.services;
    S.settings = st.settings;
  } catch (err) {
    if (err.status === 401) return;
    mount(app, h('div', { class: 'error-screen' }, h('p', null, err.message),
      h('button', { class: 'btn btn-dark', onClick: boot }, 'Повторить')));
    return;
  }
  applyTheme();
  buildShell();
  renderTab();
  clearInterval(S.timer);
  S.timer = setInterval(refreshBookings, 30000);
}

function applyTheme() {
  document.getElementById('theme-link').href = `/theme.css?v=${Date.now()}`;
  setThemeColor(S.settings.darkColor);
  document.title = `${S.settings.name}: панель владельца`;
}

function buildShell() {
  S.main = h('main', { class: 'container adm-main' });
  S.tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Разделы' }, TABS.map((t) => h('button', {
    class: 'tab', 'data-tab': t.id, onClick: () => { S.tab = t.id; window.scrollTo(0, 0); renderTab(); },
  }, icon(t.icon, 22), t.label)));

  mount(app, 
    h('header', { class: 'adm-top' },
      h('div', { class: 'adm-top-in' },
        h('img', { class: 'adm-logo', src: iconUrl(S.settings, 192), alt: '' }),
        h('div', { class: 'adm-title' }, h('b', null, S.settings.name), h('small', null, 'Панель владельца')),
        h('a', { class: 'icon-btn', href: '/', target: '_blank', rel: 'noopener' }, 'Сайт'),
        h('button', { class: 'icon-btn', 'aria-label': 'Выйти', onClick: () => logout() }, icon('logout', 22))),
      h('div', { class: 'roadline' })),
    S.main,
    S.tabbar,
  );
}

const newCount = () => S.bookings.filter((b) => b.status === 'new').length;

function updateTabbar() {
  S.tabbar.querySelectorAll('.tab').forEach((el) => {
    el.classList.toggle('on', el.dataset.tab === S.tab);
    el.querySelector('.tab-badge')?.remove();
    if (el.dataset.tab === 'bookings' && newCount()) el.append(h('span', { class: 'tab-badge' }, newCount()));
  });
}

function renderTab() {
  const views = { bookings: viewBookings, schedule: viewSchedule, services: viewServices, settings: viewSettings };
  updateTabbar();
  mount(S.main, views[S.tab]());
}

async function refreshBookings() {
  if (document.hidden || S.closeSheet) return;
  try {
    const { bookings, today } = await call('/api/admin/bookings');
    if (JSON.stringify(bookings) !== JSON.stringify(S.bookings)) {
      S.bookings = bookings;
      S.today = today;
      if (S.tab === 'bookings' || S.tab === 'schedule') renderTab();
      else updateTabbar(); // на других вкладках обновляем только бейдж
    }
  } catch { /* тихо: повторим через 30 секунд */ }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.token && S.main) refreshBookings(); });

/* ---------- Окно снизу ---------- */

function openSheet(title, ...content) {
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const backdrop = h('div', { class: 'backdrop', onClick: (e) => { if (e.target === backdrop) close(); } },
    h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'sheet-head' }, h('h3', null, title), h('button', { class: 'icon-btn', 'aria-label': 'Закрыть', onClick: () => close() }, icon('x', 22))),
      content));
  function close() {
    backdrop.remove();
    document.body.classList.remove('no-scroll');
    document.removeEventListener('keydown', onKey);
    S.closeSheet = null;
  }
  document.addEventListener('keydown', onKey);
  document.body.classList.add('no-scroll');
  document.body.append(backdrop);
  S.closeSheet = close;
  return close;
}

async function attempt(fn, okMessage) {
  try {
    await fn();
    if (okMessage) toast(okMessage, 'ok');
    return true;
  } catch (err) {
    if (err.status !== 401) toast(err.message, 'error');
    return false;
  }
}

/* ---------- Записи ---------- */

const FILTERS = [['all', 'Все'], ['new', 'Новые'], ['confirmed', 'Подтв.'], ['done', 'Выполн.'], ['cancelled', 'Отмен.']];

function dayLabel(date) {
  const base = fmtDate(date, { weekday: 'short', day: 'numeric', month: 'long' });
  if (date === S.today) return `Сегодня, ${base}`;
  if (date === addDays(S.today, 1)) return `Завтра, ${base}`;
  return base;
}

function viewBookings() {
  if (S.filter === null) S.filter = newCount() ? 'new' : 'all';
  const count = (key) => (key === 'all' ? S.bookings.length : S.bookings.filter((b) => b.status === key).length);

  const chips = h('div', { class: 'chips' }, FILTERS.map(([key, label]) => h('button', {
    class: `chip${S.filter === key ? ' on' : ''}`,
    onClick: () => { S.filter = key; renderTab(); },
  }, label, h('i', null, count(key)))));

  const items = S.bookings.filter((b) => S.filter === 'all' || b.status === S.filter);
  // Сначала предстоящие (по возрастанию), затем прошедшие (недавние выше)
  const upcoming = items.filter((b) => b.date >= S.today);
  const past = items.filter((b) => b.date < S.today).reverse();
  const ordered = [...upcoming, ...past];

  const nodes = [];
  let lastDate = null;
  for (const b of ordered) {
    if (b.date !== lastDate) {
      nodes.push(h('h3', { class: `group-title${b.date === S.today ? ' today' : ''}` }, dayLabel(b.date)));
      lastDate = b.date;
    }
    nodes.push(bookingCard(b));
  }

  return h('div', null, chips, nodes.length ? nodes : h('p', { class: 'empty' },
    S.bookings.length ? 'В этой категории записей нет.' : 'Записей пока нет. Как только клиент запишется, заявка появится здесь.'));
}

function bookingCard(b, { showTime = true } = {}) {
  const s = S.settings;
  return h('article', { class: `card b-card b-${b.status}` },
    h('div', { class: 'b-head' },
      showTime && h('div', { class: 'b-time' }, b.time),
      h('span', { class: `badge badge-${b.status}` }, STATUS[b.status])),
    h('div', { class: 'b-service' }, h('span', null, b.serviceName), h('span', { class: 'b-price' }, fmtPrice(b.price, s.currency, b.priceFrom))),
    h('div', { class: 'b-line' }, icon('user', 16), b.name),
    h('div', { class: 'b-line' }, icon('car', 16), b.car),
    h('div', { class: 'b-line' }, icon('phone', 16), h('a', { href: `tel:${b.phone}` }, b.phone)),
    h('div', { class: 'b-actions' },
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Статус записи' }, STATUS_KEYS.map((key) => h('button', {
        class: b.status === key ? 'on' : '', 'aria-pressed': b.status === key ? 'true' : 'false',
        onClick: () => setStatus(b, key),
      }, STATUS_SHORT[key]))),
      h('button', { class: 'btn btn-danger btn-sm', 'aria-label': 'Удалить запись', onClick: () => removeBooking(b) }, icon('trash', 18))));
}

async function setStatus(b, status) {
  if (b.status === status) return;
  await attempt(async () => {
    const { booking } = await call(`/api/admin/bookings/${b.id}`, { method: 'PATCH', body: { status } });
    const target = S.bookings.find((x) => x.id === b.id);
    Object.assign(target || b, booking);
    renderTab();
  }, `Статус: ${STATUS[status].toLowerCase()}`);
}

async function removeBooking(b) {
  if (!confirm(`Удалить запись «${b.name}» безвозвратно?\nЧтобы сохранить историю, лучше поставьте статус «Отмена».`)) return;
  await attempt(async () => {
    await call(`/api/admin/bookings/${b.id}`, { method: 'DELETE' });
    S.bookings = S.bookings.filter((x) => x.id !== b.id);
    renderTab();
  }, 'Запись удалена');
}

/* ---------- Расписание ---------- */

function viewSchedule() {
  if (!S.schedDate) S.schedDate = S.today;
  const activeOn = (date) => S.bookings.filter((b) => b.date === date && b.status !== 'cancelled').length;

  const strip = h('div', { class: 'days' }, Array.from({ length: 21 }, (_, i) => {
    const date = addDays(S.today, i);
    const wd = new Date(`${date}T12:00:00`).getDay();
    const n = activeOn(date);
    return h('button', {
      class: `day${date === S.schedDate ? ' sel' : ''}${S.settings.workDays.includes(wd) ? '' : ' off'}`,
      'data-date': date,
      onClick: () => { S.schedDate = date; renderTab(); },
    },
    h('small', null, DAY_NAMES[wd]),
    h('b', null, fmtDate(date, { day: 'numeric' })),
    h('span', { class: n ? 'cnt' : '' }, n ? `${n} зап.` : 'пусто'));
  }));

  const picker = h('input', {
    class: 'input', type: 'date', value: S.schedDate, 'aria-label': 'Выбрать дату',
    onChange: (e) => { if (e.target.value) { S.schedDate = e.target.value; renderTab(); } },
  });

  const body = h('div', null, spinner());
  loadSchedule(body);
  queueMicrotask(() => strip.querySelector('.sel')?.scrollIntoView({ inline: 'nearest', block: 'nearest' }));

  return h('div', null, strip, h('div', { class: 'sched-tools' }, picker), body);
}

async function loadSchedule(el) {
  const date = S.schedDate;
  try {
    const r = await call(`/api/admin/schedule?date=${date}`);
    if (date !== S.schedDate) return;
    const total = r.slots.reduce((n, sl) => n + sl.bookings.length, 0);
    mount(el, 
      h('div', { class: 'sched-title' }, fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long' })),
      h('div', { class: 'sched-sub' }, r.working ? `Записей: ${total}. Постов одновременно: ${r.posts}.` : total ? 'Выходной день, но есть записи.' : 'Выходной день'),
      r.slots.map((slot) => {
        const cards = slot.bookings.map((sb) => bookingCard(S.bookings.find((x) => x.id === sb.id) || sb, { showTime: false }));
        return h('div', { class: 'sr' },
          h('div', { class: 'sr-time' }, slot.time),
          h('div', null,
            cards.length ? [h('div', { class: 'sr-cap' }, `Занято ${cards.length} из ${r.posts}`), cards] : h('div', { class: 'sr-free' }, 'Свободно')));
      }),
    );
  } catch (err) {
    if (date === S.schedDate) mount(el, h('p', { class: 'empty' }, err.message));
  }
}

/* ---------- Услуги ---------- */

function viewServices() {
  const s = S.settings;
  const list = S.services.length
    ? h('div', { class: 'svc-list' }, S.services.map((svc) => h('button', { class: `svc${svc.active ? '' : ' hidden-svc'}`, onClick: () => openServiceSheet(svc) },
      h('div', { class: 'svc-main' },
        h('div', { class: 'svc-name' }, svc.name, !svc.active && h('span', { class: 'tag' }, 'Скрыта')),
        svc.description && h('div', { class: 'svc-desc' }, svc.description),
        h('span', { class: 'svc-meta' }, icon('clock', 14), `около ${svc.duration} мин`)),
      h('div', { class: 'svc-side' },
        h('div', { class: 'svc-price' }, fmtPrice(svc.price, s.currency, svc.priceFrom)),
        h('span', { class: 'svc-meta' }, icon('edit', 14), 'Изменить')))))
    : h('p', { class: 'empty' }, 'Услуг пока нет. Добавьте первую, и клиенты увидят её на сайте.');

  return h('div', null,
    h('button', { class: 'btn btn-dark btn-block', style: 'margin-bottom:14px', onClick: () => openServiceSheet() }, icon('plus', 20), 'Добавить услугу'),
    list);
}

function openServiceSheet(svc) {
  const isNew = !svc;
  const cur = S.settings.currency;
  const f = {
    name: h('input', { class: 'input', id: 's-name', value: svc?.name || '', maxlength: 80, placeholder: 'Например, Замена ремня ГРМ' }),
    description: h('textarea', { class: 'input', id: 's-desc', maxlength: 300, placeholder: 'Что входит в услугу' }),
    price: h('input', { class: 'input', id: 's-price', type: 'number', inputmode: 'numeric', min: 0, step: 50, value: svc?.price ?? '' }),
    duration: h('input', { class: 'input', id: 's-dur', type: 'number', inputmode: 'numeric', min: 5, step: 5, value: svc?.duration ?? 60 }),
    priceFrom: h('input', { type: 'checkbox', checked: Boolean(svc?.priceFrom) }),
    active: h('input', { type: 'checkbox', checked: svc ? svc.active : true }),
  };
  f.description.value = svc?.description || '';
  const error = h('div', { class: 'form-error', hidden: true, role: 'alert' });
  const saveBtn = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Сохранить');

  const close = openSheet(isNew ? 'Новая услуга' : 'Редактирование услуги',
    h('form', {
      novalidate: true,
      onSubmit: async (e) => {
        e.preventDefault();
        error.hidden = true;
        saveBtn.disabled = true;
        const body = {
          name: f.name.value, description: f.description.value, price: f.price.value === '' ? NaN : Number(f.price.value),
          duration: Number(f.duration.value), priceFrom: f.priceFrom.checked, active: f.active.checked,
        };
        try {
          const path = isNew ? '/api/admin/services' : `/api/admin/services/${svc.id}`;
          const { service } = await call(path, { method: isNew ? 'POST' : 'PUT', body });
          if (isNew) S.services.push(service);
          else Object.assign(svc, service);
          close();
          renderTab();
          toast('Услуга сохранена', 'ok');
        } catch (ex) {
          saveBtn.disabled = false;
          if (ex.status === 401) return;
          error.textContent = ex.message;
          error.hidden = false;
        }
      },
    },
    error,
    h('div', { class: 'field' }, h('label', { for: 's-name' }, 'Название'), f.name),
    h('div', { class: 'field' }, h('label', { for: 's-desc' }, 'Описание'), f.description),
    h('div', { class: 'grid2' },
      h('div', { class: 'field' }, h('label', { for: 's-price' }, `Цена, ${cur}`), f.price),
      h('div', { class: 'field' }, h('label', { for: 's-dur' }, 'Длительность, мин'), f.duration)),
    h('label', { class: 'check' }, f.priceFrom, 'Показывать цену как «от»'),
    h('label', { class: 'check' }, f.active, 'Показывать клиентам'),
    h('div', { class: 'sheet-actions' },
      saveBtn,
      !isNew && h('button', {
        class: 'btn btn-danger', type: 'button',
        onClick: async () => {
          if (!confirm(`Удалить услугу «${svc.name}»? Прошлые записи сохранятся.`)) return;
          const ok = await attempt(async () => {
            await call(`/api/admin/services/${svc.id}`, { method: 'DELETE' });
            S.services = S.services.filter((x) => x.id !== svc.id);
          }, 'Услуга удалена');
          if (ok) { close(); renderTab(); }
        },
      }, 'Удалить услугу'))));
  f.name.focus();
}

/* ---------- Настройки ---------- */

const lbl = (id, text, control, hint) => h('div', { class: 'field' }, h('label', { for: id }, text), control, hint && h('div', { class: 'hint' }, hint));

function viewSettings() {
  const s = S.settings;
  const text = (id, key, extra = {}) => h('input', { class: 'input', id, value: s[key] ?? '', ...extra });
  const c = {
    name: text('st-name', 'name', { maxlength: 60 }),
    tagline: text('st-tag', 'tagline', { maxlength: 120, placeholder: 'Например, Ремонт и обслуживание авто' }),
    phone: text('st-phone', 'phone', { type: 'tel', maxlength: 30 }),
    address: text('st-addr', 'address', { maxlength: 120 }),
    currency: text('st-cur', 'currency', { maxlength: 5 }),
    primaryColor: h('input', { type: 'color', id: 'st-c1', value: s.primaryColor }),
    darkColor: h('input', { type: 'color', id: 'st-c2', value: s.darkColor }),
    workStart: text('st-ws', 'workStart', { type: 'time' }),
    workEnd: text('st-we', 'workEnd', { type: 'time' }),
    slotMinutes: h('select', { class: 'input', id: 'st-slot' }, [30, 45, 60, 90, 120, 180].map((m) => h('option', { value: m, selected: s.slotMinutes === m }, `${m} мин`))),
    posts: text('st-posts', 'posts', { type: 'number', inputmode: 'numeric', min: 1, max: 30 }),
    daysAhead: text('st-days', 'daysAhead', { type: 'number', inputmode: 'numeric', min: 1, max: 90 }),
    leadMinutes: h('select', { class: 'input', id: 'st-lead' }, [[0, 'Без ограничений'], [30, '30 минут'], [60, '1 час'], [120, '2 часа'], [240, '4 часа'], [1440, 'За сутки']]
      .map(([m, label]) => h('option', { value: m, selected: s.leadMinutes === m }, label))),
    timezone: text('st-tz', 'timezone', { list: 'tz-list', autocomplete: 'off' }),
  };
  // Если сохранённое значение не совпало ни с одним пунктом списка, добавим его
  for (const key of ['slotMinutes', 'leadMinutes']) {
    if (![...c[key].options].some((o) => Number(o.value) === s[key])) c[key].append(h('option', { value: s[key], selected: true }, String(s[key])));
  }
  const days = new Set(s.workDays);
  const dayChips = h('div', { class: 'chips', style: 'flex-wrap:wrap;overflow:visible;margin:0;padding:0 0 12px' }, WEEK.map((d) => {
    const chip = h('button', {
      type: 'button', class: `chip${days.has(d) ? ' on' : ''}`, 'aria-pressed': days.has(d) ? 'true' : 'false',
      onClick: () => {
        if (days.has(d)) days.delete(d); else days.add(d);
        chip.classList.toggle('on', days.has(d));
        chip.setAttribute('aria-pressed', days.has(d) ? 'true' : 'false');
      },
    }, DAY_NAMES[d]);
    return chip;
  }));

  const error = h('div', { class: 'form-error', hidden: true, role: 'alert' });
  const saveBtn = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Сохранить настройки');

  const onSave = async (e) => {
    e.preventDefault();
    error.hidden = true;
    saveBtn.disabled = true;
    const body = {
      name: c.name.value, tagline: c.tagline.value, phone: c.phone.value, address: c.address.value, currency: c.currency.value,
      primaryColor: c.primaryColor.value, darkColor: c.darkColor.value,
      workStart: c.workStart.value, workEnd: c.workEnd.value, slotMinutes: Number(c.slotMinutes.value),
      posts: Number(c.posts.value), daysAhead: Number(c.daysAhead.value), leadMinutes: Number(c.leadMinutes.value),
      timezone: c.timezone.value.trim(), workDays: [...days],
    };
    try {
      const { settings } = await call('/api/admin/settings', { method: 'PUT', body });
      S.settings = settings;
      applyTheme();
      buildShell();
      renderTab();
      toast('Настройки сохранены', 'ok');
    } catch (ex) {
      saveBtn.disabled = false;
      if (ex.status === 401) return;
      error.textContent = ex.message;
      error.hidden = false;
      error.scrollIntoView({ block: 'center' });
    }
  };

  /* Логотип */
  const preview = h('img', { src: iconUrl(s, 192), alt: 'Текущий логотип', width: 72, height: 72 });
  const resetBtn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', hidden: s.logoVersion <= 0, onClick: () => resetLogo(refreshLogo) }, 'Сбросить');
  // Логотип сохраняется сразу, поэтому обновляем только превью: несохранённые правки формы не трогаем
  function refreshLogo() {
    preview.src = iconUrl(S.settings, 192);
    resetBtn.hidden = S.settings.logoVersion <= 0;
    const top = document.querySelector('.adm-logo');
    if (top) top.src = iconUrl(S.settings, 192);
  }
  const file = h('input', { type: 'file', accept: 'image/*', hidden: true, onChange: () => uploadLogo(file, refreshLogo) });
  const logoPanel = h('div', { class: 'field' },
    h('span', { class: 'field-label' }, 'Логотип'),
    h('div', { class: 'logo-row' }, preview,
      h('div', { class: 'logo-btns' },
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => file.click() }, 'Загрузить'),
        resetBtn)),
    h('div', { class: 'hint' }, 'Лучше квадратное изображение на сплошном фоне. Оно станет иконкой приложения на телефоне клиента.'),
    file);

  /* Пароль */
  const cur = h('input', { class: 'input', id: 'pw-cur', type: 'password', autocomplete: 'current-password' });
  const next = h('input', { class: 'input', id: 'pw-new', type: 'password', autocomplete: 'new-password', placeholder: 'Минимум 6 символов' });
  const pwBtn = h('button', { class: 'btn btn-ghost btn-block', type: 'button', style: 'margin-bottom:12px', onClick: async () => {
    pwBtn.disabled = true;
    const ok = await attempt(async () => {
      const { token } = await call('/api/admin/password', { method: 'POST', body: { current: cur.value, next: next.value } });
      S.token = token;
      localStorage.setItem('adm_token', token);
      cur.value = '';
      next.value = '';
    }, 'Пароль изменён');
    pwBtn.disabled = false;
    return ok;
  } }, 'Сменить пароль');

  return h('div', null,
    h('form', { novalidate: true, onSubmit: onSave },
      error,
      h('section', { class: 'panel' },
        h('h3', null, 'Автосервис'),
        lbl('st-name', 'Название', c.name),
        lbl('st-tag', 'Слоган', c.tagline),
        lbl('st-phone', 'Телефон', c.phone),
        lbl('st-addr', 'Адрес', c.address),
        logoPanel,
        h('div', { class: 'grid2' },
          h('div', { class: 'field' }, h('label', { for: 'st-c1' }, 'Основной цвет'), h('div', { class: 'color-field' }, c.primaryColor)),
          h('div', { class: 'field' }, h('label', { for: 'st-c2' }, 'Тёмный цвет'), h('div', { class: 'color-field' }, c.darkColor))),
        lbl('st-cur', 'Валюта', c.currency)),
      h('section', { class: 'panel' },
        h('h3', null, 'Запись клиентов'),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Рабочие дни'), dayChips),
        h('div', { class: 'grid2' }, lbl('st-ws', 'Открытие', c.workStart), lbl('st-we', 'Закрытие', c.workEnd)),
        h('div', { class: 'grid2' },
          lbl('st-slot', 'Длина окна', c.slotMinutes),
          lbl('st-posts', 'Постов', c.posts, 'Сколько машин можно принять одновременно')),
        h('div', { class: 'grid2' },
          lbl('st-days', 'Запись на дней вперёд', c.daysAhead),
          lbl('st-lead', 'Записываться не позднее чем за', c.leadMinutes)),
        lbl('st-tz', 'Часовой пояс', c.timezone, 'Например, Europe/Moscow, Asia/Yekaterinburg, Europe/Minsk'),
        h('datalist', { id: 'tz-list' }, ['Europe/Moscow', 'Europe/Kaliningrad', 'Europe/Samara', 'Asia/Yekaterinburg', 'Asia/Novosibirsk', 'Asia/Krasnoyarsk', 'Asia/Irkutsk', 'Asia/Vladivostok', 'Europe/Minsk', 'Europe/Kyiv', 'Asia/Almaty', 'Asia/Tashkent', 'Asia/Tbilisi', 'UTC'].map((z) => h('option', { value: z })))),
      h('div', { class: 'save-bar' }, saveBtn)),
    h('section', { class: 'panel', style: 'margin-top:14px' },
      h('h3', null, 'Безопасность'),
      lbl('pw-cur', 'Текущий пароль', cur),
      lbl('pw-new', 'Новый пароль', next),
      pwBtn));
}

async function uploadLogo(input, onDone) {
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  await attempt(async () => {
    if (!file.type.startsWith('image/')) throw new Error('Выберите файл изображения');
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch {
      throw new Error('Не удалось прочитать изображение. Попробуйте PNG или JPG.');
    }
    const render = (size) => {
      const canvas = h('canvas', { width: size, height: size });
      const ctx = canvas.getContext('2d');
      const k = Math.min(size / img.naturalWidth, size / img.naturalHeight);
      const w = img.naturalWidth * k;
      const hh = img.naturalHeight * k;
      ctx.drawImage(img, (size - w) / 2, (size - hh) / 2, w, hh);
      return canvas.toDataURL('image/png');
    };
    const png512 = render(512);
    const png192 = render(192);
    URL.revokeObjectURL(url);
    if (png512.length > 780000) throw new Error('Изображение слишком сложное. Загрузите более простой логотип.');
    const { logoVersion } = await call('/api/admin/logo', { method: 'PUT', body: { png512, png192 } });
    S.settings.logoVersion = logoVersion;
    onDone();
  }, 'Логотип обновлён');
}

async function resetLogo(onDone) {
  await attempt(async () => {
    const { logoVersion } = await call('/api/admin/logo', { method: 'DELETE' });
    S.settings.logoVersion = logoVersion;
    onDone();
  }, 'Логотип сброшен');
}

/* ---------- Старт ---------- */

registerSW();
if (S.token) boot();
else showLogin();
