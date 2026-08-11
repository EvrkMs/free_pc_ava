#!/usr/bin/env node
'use strict';

/**
 * Вход в панель Langame (226.langame.ru) с этой машины.
 *
 *   node login.js            вход (спросит логин и пароль)
 *   node login.js --check    проверить, жива ли сохранённая сессия
 *   node login.js --logout   удалить сохранённую сессию
 *
 * Логин/пароль можно передать через переменные окружения
 * LANGAME_LOGIN / LANGAME_PASSWORD — тогда вопросов не будет.
 *
 * Работает только на этой Windows-машине: сертификат клиента лежит
 * в Cert:\CurrentUser\My и не экспортируется, curl.exe обращается
 * к нему через Schannel/CNG.
 */

const readline = require('node:readline');
const config = require('./src/langame/config');
const auth = require('./src/langame/auth');
const mtls = require('./src/langame/mtls');
const { listCandidates } = require('./src/langame/cert');

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    let muted = false;
    rl._writeToOutput = (str) => {
      if (!muted) rl.output.write(str);
    };

    rl.question(question, (answer) => {
      if (hidden) rl.output.write('\n');
      rl.close();
      resolve(answer);
    });

    muted = hidden;
  });
}

function printCert() {
  const ref = mtls.certRef();
  console.log(`Сертификат : ${ref}`);
  const info = listCandidates().find((c) => ref.endsWith(c.Thumbprint));
  if (info) {
    console.log(`             ${info.Subject}`);
    console.log(`             действует до ${new Date(info.NotAfter).toLocaleDateString('ru-RU')}`);
  }
  console.log(`Панель     : ${config.baseUrl}`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--logout')) {
    auth.logout();
    console.log('Сессия удалена.');
    return;
  }

  printCert();

  if (args.includes('--check')) {
    const ok = auth.isAuthenticated();
    console.log(ok ? '\nСессия активна.' : '\nСессия не активна — нужен вход.');
    process.exitCode = ok ? 0 : 1;
    return;
  }

  console.log('');
  const userLogin = process.env.LANGAME_LOGIN || (await ask('Логин: '));
  const password = process.env.LANGAME_PASSWORD || (await ask('Пароль: ', { hidden: true }));

  if (!userLogin || !password) {
    console.error('Логин и пароль обязательны.');
    process.exitCode = 2;
    return;
  }

  const result = auth.login(userLogin, password);

  if (result.ok) {
    console.log(`Вход выполнен. Сессия сохранена в ${config.cookieJar}`);
  } else {
    console.error(`Не удалось войти: ${result.reason}`);
    if (result.location) console.error(`Ответ сервера: ${result.status} -> ${result.location}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Ошибка: ' + err.message);
  process.exitCode = 1;
});
