'use strict';
const crypto = require('node:crypto');

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 дней

function createPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, admin) {
  if (typeof password !== 'string' || !admin) return false;
  const got = crypto.scryptSync(password, admin.salt, 64);
  const want = Buffer.from(admin.hash, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

// Токен = "<срок>.<подпись>". Подпись зависит от секрета и текущего пароля,
// поэтому смена пароля автоматически разлогинивает все старые сессии.
function sign(secret, admin, exp) {
  return crypto.createHmac('sha256', secret).update(`${exp}.${admin.hash}`).digest('hex');
}

function issueToken(secret, admin) {
  const exp = Date.now() + TOKEN_TTL_MS;
  return `${exp}.${sign(secret, admin, exp)}`;
}

function verifyToken(secret, admin, token) {
  if (typeof token !== 'string') return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const want = Buffer.from(sign(secret, admin, exp));
  const got = Buffer.from(sig);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

// Простейший ограничитель частоты запросов в памяти процесса.
function createLimiter(max, windowMs) {
  const hits = new Map();
  return function hit(key) {
    const now = Date.now();
    const rec = hits.get(key);
    if (!rec || rec.resetAt < now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    rec.count += 1;
    return rec.count <= max;
  };
}

module.exports = { createPassword, verifyPassword, issueToken, verifyToken, createLimiter };
