'use strict';
// Хранилище: один JSON-файл. Для автосервиса (десятки записей в день) этого
// достаточно; запись атомарная (tmp-файл + rename).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const auth = require('./auth');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const DB_FILE = path.join(DATA_DIR, 'db.json');
const BRAND_FILE = path.resolve(process.env.BRAND_FILE || path.join(ROOT, 'config', 'brand.default.json'));

const DEFAULT_SETTINGS = {
  name: 'Автосервис',
  tagline: '',
  phone: '',
  address: '',
  primaryColor: '#ffc400',
  darkColor: '#0f2a33',
  currency: '₽',
  timezone: 'Europe/Moscow',
  workStart: '09:00',
  workEnd: '19:00',
  slotMinutes: 60,
  posts: 1,
  workDays: [1, 2, 3, 4, 5],
  daysAhead: 21,
  leadMinutes: 60,
  logoVersion: 0,
};

let db = null;

const uid = () => crypto.randomBytes(6).toString('hex');

function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    db.settings = { ...DEFAULT_SETTINGS, ...db.settings };
    return db;
  }
  const { services = [], ...brand } = JSON.parse(fs.readFileSync(BRAND_FILE, 'utf8'));
  db = {
    settings: { ...DEFAULT_SETTINGS, ...brand },
    services: services.map((s) => ({ id: uid(), active: true, priceFrom: false, duration: 60, description: '', ...s })),
    bookings: [],
    admin: auth.createPassword(process.env.ADMIN_PASSWORD || 'admin123'),
    secret: crypto.randomBytes(32).toString('hex'),
  };
  save();
  return db;
}

function save() {
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

module.exports = {
  DATA_DIR,
  uid,
  load,
  save,
  get db() {
    return db;
  },
};
