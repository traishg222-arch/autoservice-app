'use strict';
// Использование: npm run set-password -- НовыйПароль
const store = require('../lib/store');
const auth = require('../lib/auth');

const pw = process.argv[2];
if (!pw || pw.length < 6) {
  console.error('Укажите новый пароль (минимум 6 символов): npm run set-password -- НовыйПароль');
  process.exit(1);
}
store.load();
store.db.admin = auth.createPassword(pw);
store.save();
console.log('Пароль владельца обновлён. Все старые сессии завершены.');
