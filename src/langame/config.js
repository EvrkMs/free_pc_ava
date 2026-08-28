'use strict';

const path = require('node:path');

/**
 * Настройки подключения к панели Langame.
 *
 * Ничего секретного в этом файле нет:
 * - LANGAME_PFX_PATH — путь к клиентскому сертификату (PKCS#12, .p12/.pfx);
 * - LANGAME_PFX_PASSPHRASE — пароль от него, только из переменных окружения;
 * - логин/пароль от панели — тоже только из переменных окружения.
 */
const config = {
  baseUrl: process.env.LANGAME_BASE_URL || 'https://226.langame.ru',

  /** Путь к клиентскому сертификату в формате PKCS#12 (.p12/.pfx). */
  pfxPath:
    process.env.LANGAME_PFX_PATH ||
    path.join(__dirname, '..', '..', 'secrets', 'langame.p12'),

  /** Пароль от .p12-файла (пустая строка, если сертификат без пароля). */
  pfxPassphrase: process.env.LANGAME_PFX_PASSPHRASE || '',

  /** Логин/пароль для автоматического входа при протухшей сессии. */
  login: process.env.LANGAME_LOGIN || null,
  password: process.env.LANGAME_PASSWORD || null,

  lang: process.env.LANGAME_LANG || 'ru',

  /** Куда складывать cookie-store с PHPSESSID. */
  sessionDir: path.join(__dirname, '..', '..', '.session'),

  timeout: Number(process.env.LANGAME_TIMEOUT || 30),
};

config.cookieFile = path.join(config.sessionDir, 'cookies.json');

module.exports = config;
