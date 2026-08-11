'use strict';

const path = require('node:path');

/**
 * Настройки подключения к панели Langame.
 *
 * Ничего секретного здесь нет и быть не должно:
 * - отпечаток сертификата — публичный идентификатор, не секрет;
 * - приватный ключ живёт в хранилище Windows (CNG) и помечен non-exportable,
 *   наружу он не выходит никогда;
 * - логин/пароль берутся только из переменных окружения, в коде их нет.
 */
const config = {
  baseUrl: process.env.LANGAME_BASE_URL || 'https://226.langame.ru',

  /** Ссылка на сертификат в формате curl/Schannel: CurrentUser\MY\<отпечаток>. */
  certRef: process.env.LANGAME_CERT_REF || null,

  /** CN издателя, по которому ищем сертификат при автоопределении. */
  certIssuerMatch: process.env.LANGAME_CERT_ISSUER || 'langame.ru',

  /** Логин/пароль для автоматического входа при протухшей сессии. */
  login: process.env.LANGAME_LOGIN || null,
  password: process.env.LANGAME_PASSWORD || null,

  lang: process.env.LANGAME_LANG || 'ru',

  /** Куда складывать cookie-jar с PHPSESSID. */
  sessionDir: path.join(__dirname, '..', '..', '.session'),

  timeout: Number(process.env.LANGAME_TIMEOUT || 30),
};

config.cookieJar = path.join(config.sessionDir, 'cookies.txt');

module.exports = config;
