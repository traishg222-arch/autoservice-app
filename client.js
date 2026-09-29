import { api } from './api.js';
import { h, mount, icon, fmtPrice, fmtDate, fmtDateLong, workDaysText, iconUrl, toast, setThemeColor, registerSW } from './ui.js';

const app = document.getElementById('app');
const CACHE_KEY = 'public-cache';

const state = {
  settings: null,
  services: [],
  days: [],
  offline: false,
  service: null,
  date: null,
  time: null,
  booking: null,
  profile: loadProfile(),
};

function loadProfile() {
  try {
    return { name: '', phone: '', car: '', ...JSON.parse(localStorage.getItem('profile') || '{}') };
  } catch {
    return { name: '', phone: '', car: '' };
  }
}

/* ---------- Навигация (кнопка «назад» на телефоне переходит на предыдущий шаг) ---------- */

const VIEWS = { home: showHome, date: showDate, form: showForm, done: showDone };

function go(view, { replace = false } = {}) {
  history[replace ? 'replaceState' : 'pushState']({ view }, '');
  render(view);
}

function render(view) {
  // Защита от перехода на шаг, для которого ещё нет данных
  let target = view;
  // Возврат назад с экрана подтверждения не должен позволять отправить запись повторно
  if (state.booking && target !== 'done') {
    state.booking = null;
    target = 'home';
  }
  if (target === 'done' && !state.booking) target = 'home';
  if ((target === 'date' || target === 'form') && !state.service) target = 'home';
  if (target === 'form' && !state.time) target = 'date';
  if (target === 'home') resetBooking();
  VIEWS[target]();
  window.scrollTo(0, 0);
}

function resetBooking() {
  state.service = null;
  state.date = null;
  state.time = null;
}

window.addEventListener('popstate', (e) => render(e.state?.view || 'home'));

/* ---------- Загрузка данных ---------- */

async function init() {
  registerSW();
  try {
    const data = await api('/api/public');
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    apply(data);
  } catch (err) {
    const cached = readCache();
    if (!cached) return showFatal(err.message);
    apply(cached);
    state.offline = true;
  }
  history.replaceState({ view: 'home' }, '');
  render('home');
}

function readCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY));
  } catch {
    return null;
  }
}

function apply(data) {
  state.settings = data.settings;
  state.services = data.services;
  state.days = data.days;
  document.title = `${data.settings.name}: онлайн-запись`;
  setThemeColor(data.settings.darkColor);
}

function showFatal(message) {
  mount(app, 
    h('div', { class: 'error-screen' },
      h('h2', null, 'Не удалось загрузить приложение'),
      h('p', null, message),
      h('button', { class: 'btn btn-dark', onClick: () => location.reload() }, 'Повторить')),
  );
}

/* ---------- Главная ---------- */

function showHome() {
  const s = state.settings;
  const hours = `${workDaysText(s.workDays)}, ${s.workStart}–${s.workEnd}`;

  const hero = h('header', { class: 'hero' },
    h('div', { class: 'container' },
      h('div', { class: 'brand' },
        h('img', { class: 'brand-logo', src: iconUrl(s), alt: '', width: 68, height: 68 }),
        h('div', null, h('h1', null, s.name), s.tagline && h('p', { class: 'tagline' }, s.tagline))),
      h('ul', { class: 'facts' },
        h('li', null, icon('clock'), hours),
        s.address && h('li', null, icon('pin'), s.address)),
      h('div', { class: 'hero-actions' },
        h('button', { class: 'btn btn-primary', onClick: () => document.getElementById('services').scrollIntoView({ behavior: 'smooth' }) }, 'Записаться'),
        s.phone && h('a', { class: 'btn btn-outline', href: `tel:${s.phone.replace(/[^\d+]/g, '')}` }, icon('phone', 18), 'Позвонить'))));

  const list = state.services.length
    ? h('div', { class: 'svc-list' }, state.services.map((svc) => serviceRow(svc)))
    : h('div', { class: 'svc-list' }, h('p', { class: 'empty' }, 'Список услуг скоро появится. Позвоните нам, и мы запишем вас по телефону.'));

  mount(app, 
    state.offline && h('div', { class: 'offline-note' }, 'Нет соединения. Показаны сохранённые данные, запись недоступна.'),
    hero,
    h('main', { class: 'container' },
      h('section', { class: 'section', id: 'services' }, h('h2', null, 'Выберите услугу'), list)),
    h('footer', { class: 'footer' }, s.name, s.phone && h('div', null, s.phone)),
  );
}

function serviceRow(svc) {
  const s = state.settings;
  return h('button', { class: 'svc', onClick: () => chooseService(svc) },
    h('div', { class: 'svc-main' },
      h('div', { class: 'svc-name' }, svc.name),
      svc.description && h('div', { class: 'svc-desc' }, svc.description),
      h('span', { class: 'svc-meta' }, icon('clock', 14), `около ${svc.duration} мин`)),
    h('div', { class: 'svc-side' },
      h('div', { class: 'svc-price' }, fmtPrice(svc.price, s.currency, svc.priceFrom)),
      h('span', { class: 'pill' }, 'Выбрать')));
}

function chooseService(svc) {
  if (state.offline) return toast('Нет соединения: запись сейчас недоступна', 'error');
  state.service = svc;
  state.date = null;
  state.time = null;
  go('date');
}

/* ---------- Общие части экранов записи ---------- */

function screen(title, step, body, bar) {
  return h('div', { class: 'screen' },
    h('div', { class: 'topbar' },
      h('div', { class: 'topbar-inner' },
        h('button', { class: 'icon-btn', 'aria-label': 'Назад', onClick: () => history.back() }, icon('back', 22)),
        h('h2', null, title))),
    h('div', { class: 'steps', 'aria-hidden': 'true' }, [1, 2].map((n) => h('i', { class: n <= step ? 'on' : '' }))),
    h('main', { class: 'screen-body container' }, body),
    bar);
}

function serviceSummary() {
  const svc = state.service;
  return h('div', { class: 'summary' },
    h('div', { class: 'summary-main' },
      h('div', { class: 'summary-name' }, svc.name),
      h('div', { class: 'summary-sub' }, `около ${svc.duration} мин`)),
    h('div', { class: 'summary-price' }, fmtPrice(svc.price, state.settings.currency, svc.priceFrom)));
}

const whenText = () => `${fmtDate(state.date, { weekday: 'short', day: 'numeric', month: 'long' })}, ${state.time}`;

/* ---------- Шаг 1: дата и время ---------- */

function showDate() {
  const workingDays = state.days.filter((d) => d.working);
  if (!state.date || !workingDays.some((d) => d.date === state.date)) {
    state.date = workingDays[0]?.date || null;
    state.time = null;
  }

  const lot = h('div', { class: 'lot' }, h('div', { class: 'spinner', style: 'margin:24px auto;border-color:rgba(255,255,255,.25);border-top-color:#fff' }));
  const next = h('button', { class: 'btn btn-primary', disabled: !state.time, onClick: () => go('form') }, 'Далее');
  const barInfo = h('div', { class: 'bar-info' });
  const daysEl = h('div', { class: 'days', role: 'listbox', 'aria-label': 'Дата' });

  function updateBar() {
    mount(barInfo, state.time
      ? [h('b', null, whenText()), state.service.name]
      : 'Выберите дату и время');
    next.disabled = !state.time;
  }

  async function loadSlots() {
    const requested = state.date;
    if (!requested) {
      mount(lot, h('p', { class: 'lot-note' }, 'Онлайн-запись сейчас недоступна. Позвоните нам.'));
      return;
    }
    mount(lot, h('div', { class: 'spinner', style: 'margin:24px auto;border-color:rgba(255,255,255,.25);border-top-color:#fff' }));
    try {
      const { slots } = await api(`/api/slots?date=${requested}`);
      if (requested !== state.date) return; // пользователь уже выбрал другой день
      renderSlots(slots.filter((x) => !x.past)); // прошедшее время не показываем
    } catch (err) {
      if (requested !== state.date) return;
      mount(lot, h('p', { class: 'lot-note' }, err.message), h('button', { class: 'btn btn-outline btn-sm', style: 'color:#fff;margin:0 auto;display:flex', onClick: loadSlots }, 'Повторить'));
    }
  }

  function renderSlots(slots) {
    if (!slots.some((x) => x.free)) {
      mount(lot, h('p', { class: 'lot-note' }, 'На этот день свободных окон нет. Выберите другую дату.'));
      return;
    }
    mount(lot, h('div', { class: 'bays', role: 'listbox', 'aria-label': 'Время' }, slots.map((slot) => {
      const btn = h('button', {
        class: `bay${slot.time === state.time ? ' sel' : ''}`,
        disabled: !slot.free,
        role: 'option',
        'aria-selected': slot.time === state.time ? 'true' : 'false',
        onClick: () => {
          state.time = slot.time;
          lot.querySelectorAll('.bay').forEach((b) => { b.classList.remove('sel'); b.setAttribute('aria-selected', 'false'); });
          btn.classList.add('sel');
          btn.setAttribute('aria-selected', 'true');
          updateBar();
        },
      }, slot.time, !slot.free && h('small', null, 'занято'));
      return btn;
    })));
  }

  function renderDays() {
    mount(daysEl, state.days.map((d) => h('button', {
      class: `day${d.date === state.date ? ' sel' : ''}`,
      disabled: !d.working,
      role: 'option',
      'aria-selected': d.date === state.date ? 'true' : 'false',
      'data-date': d.date,
      onClick: () => {
        if (d.date === state.date) return;
        state.date = d.date;
        state.time = null;
        daysEl.querySelectorAll('.day').forEach((el) => el.classList.toggle('sel', el.dataset.date === d.date));
        updateBar();
        loadSlots();
      },
    },
    h('small', null, fmtDate(d.date, { weekday: 'short' })),
    h('b', null, fmtDate(d.date, { day: 'numeric' })),
    h('span', null, fmtDate(d.date, { month: 'short' })))));
  }

  renderDays();
  updateBar();
  mount(app, screen('Дата и время', 1, [
    serviceSummary(),
    h('div', { class: 'label' }, 'Дата'),
    daysEl,
    h('div', { class: 'label' }, 'Время'),
    lot,
  ], h('div', { class: 'bar' }, h('div', { class: 'container' }, barInfo, next))));
  daysEl.querySelector('.sel')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  loadSlots();
}

/* ---------- Шаг 2: данные клиента ---------- */

function showForm() {
  const p = state.profile;
  const fields = {
    name: h('input', { class: 'input', id: 'f-name', value: p.name, autocomplete: 'name', autocapitalize: 'words', placeholder: 'Как к вам обращаться', maxlength: 60 }),
    phone: h('input', { class: 'input', id: 'f-phone', value: p.phone, type: 'tel', inputmode: 'tel', autocomplete: 'tel', placeholder: '+7 900 000-00-00', maxlength: 30 }),
    car: h('input', { class: 'input', id: 'f-car', value: p.car, autocomplete: 'off', placeholder: 'Например, Kia Rio 2018', maxlength: 60 }),
  };
  const errors = { name: h('div', { class: 'error' }), phone: h('div', { class: 'error' }), car: h('div', { class: 'error' }) };
  const formError = h('div', { class: 'form-error', hidden: true, role: 'alert' });
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Записаться');

  const field = (key, label, hint) => h('div', { class: 'field' },
    h('label', { for: `f-${key}` }, label), fields[key], hint && h('div', { class: 'hint' }, hint), errors[key]);

  function validate() {
    const v = { name: fields.name.value.trim(), phone: fields.phone.value.trim(), car: fields.car.value.trim() };
    const msg = {
      name: v.name.length < 2 ? 'Введите имя' : '',
      phone: v.phone.replace(/\D/g, '').length < 10 ? 'Введите номер телефона полностью' : '',
      car: v.car.length < 2 ? 'Укажите марку и модель автомобиля' : '',
    };
    for (const k of Object.keys(msg)) {
      errors[k].textContent = msg[k];
      fields[k].classList.toggle('invalid', Boolean(msg[k]));
    }
    const firstBad = Object.keys(msg).find((k) => msg[k]);
    if (firstBad) fields[firstBad].focus();
    return firstBad ? null : v;
  }

  async function onSubmit(e) {
    e.preventDefault();
    formError.hidden = true;
    const values = validate();
    if (!values) return;
    submit.disabled = true;
    submit.textContent = 'Отправляем…';
    try {
      const { booking } = await api('/api/bookings', {
        method: 'POST',
        body: { serviceId: state.service.id, date: state.date, time: state.time, ...values },
      });
      state.profile = values;
      localStorage.setItem('profile', JSON.stringify(values));
      state.booking = booking;
      go('done');
    } catch (err) {
      submit.disabled = false;
      submit.textContent = 'Записаться';
      if (err.status === 409) {
        toast(err.message, 'error');
        state.time = null;
        history.back(); // вернуться к выбору времени, слоты обновятся
        return;
      }
      formError.textContent = err.message;
      formError.hidden = false;
      formError.scrollIntoView({ block: 'center' });
    }
  }

  mount(app, screen('Ваши данные', 2, [
    serviceSummary(),
    h('div', { class: 'summary', style: 'margin-top:8px' },
      h('div', { class: 'summary-main' },
        h('div', { class: 'summary-name' }, whenText()),
        h('div', { class: 'summary-sub' }, state.settings.address || state.settings.name)),
      h('button', { class: 'link-btn', onClick: () => history.back() }, 'Изменить')),
    h('form', { style: 'margin-top:24px', novalidate: true, onSubmit },
      formError,
      field('name', 'Ваше имя'),
      field('phone', 'Телефон', 'Позвоним или напишем, чтобы подтвердить запись'),
      field('car', 'Марка и модель автомобиля'),
      h('div', { style: 'margin-top:8px' }, submit)),
  ]));
}

/* ---------- Шаг 3: подтверждение ---------- */

function showDone() {
  const b = state.booking;
  const s = state.settings;

  mount(app, h('div', { class: 'screen' },
    h('main', { class: 'screen-body container done' },
      h('div', { class: 'done-mark' }, icon('check', 38)),
      h('h1', null, 'Вы записаны'),
      h('p', { class: 'done-sub' }, 'Мы свяжемся с вами по телефону и подтвердим запись.'),
      h('div', { class: 'ticket' },
        h('div', { class: 'ticket-top' },
          h('div', { class: 'ticket-when' }, fmtDateLong(b.date)),
          h('div', { class: 'ticket-time' }, b.time)),
        h('div', { class: 'ticket-cut' }),
        h('div', { class: 'ticket-rows' },
          row('Услуга', b.serviceName),
          row('Стоимость', fmtPrice(b.price, s.currency, b.priceFrom)),
          row('Автомобиль', b.car),
          row('На имя', b.name),
          s.address && row('Адрес', s.address),
          row('Номер записи', b.id.slice(0, 6).toUpperCase()))),
      h('div', { class: 'done-actions' },
        h('button', { class: 'btn btn-dark', onClick: () => downloadIcs(b) }, icon('calendar', 18), 'Добавить в календарь'),
        s.phone && h('a', { class: 'btn btn-ghost', href: `tel:${s.phone.replace(/[^\d+]/g, '')}` }, icon('phone', 18), 'Позвонить в автосервис'),
        h('button', { class: 'btn btn-ghost', onClick: finish }, 'На главную')))));
}

const row = (label, value) => h('div', { class: 'row' }, h('span', null, label), h('b', null, value));

function finish() {
  state.booking = null;
  go('home', { replace: true });
}

function downloadIcs(b) {
  const s = state.settings;
  const [hh, mm] = b.time.split(':').map(Number);
  const endMin = Math.min(hh * 60 + mm + s.slotMinutes, 23 * 60 + 59);
  const stamp = (date, min) => `${date.replace(/-/g, '')}T${String(Math.floor(min / 60)).padStart(2, '0')}${String(min % 60).padStart(2, '0')}00`;
  const esc = (t) => String(t).replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//autoservice//RU', 'BEGIN:VEVENT',
    `UID:${b.id}@autoservice`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]|\.\d{3}/g, '')}`,
    `DTSTART:${stamp(b.date, hh * 60 + mm)}`,
    `DTEND:${stamp(b.date, endMin)}`,
    `SUMMARY:${esc(`${s.name}: ${b.serviceName}`)}`,
    `LOCATION:${esc(s.address || s.name)}`,
    `DESCRIPTION:${esc(`Автомобиль: ${b.car}. Телефон: ${s.phone}`)}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  const a = h('a', { href: url, download: 'zapis.ics' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

init();
