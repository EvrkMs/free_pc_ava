'use strict';

const path = require('node:path');

/**
 * Настройки подключения к панели Langame.
 *
 * Ничего секретного в этом файле нет:
 * - LANGAME_PFX_PATH — путь к клиентскому сертификату (PKCS#12, .p12/.pfx);
 * - LANGAME_PFX_PASSPHRASE — пароль от него, только из переменных окружения;
 * - логин/пароль от панели — тоже только из переменных окружения;
 * - LANGAME_API_KEY — Standalone серверный ключ для публичного API (зоны/типы ПК).
 */
const config = {
  /** Адрес панели клуба, например https://<номер>.langame.ru. Обязателен. */
  baseUrl: (process.env.LANGAME_BASE_URL || '').replace(/\/$/, ''),

  /** Путь к клиентскому сертификату в формате PKCS#12 (.p12/.pfx). */
  pfxPath:
    process.env.LANGAME_PFX_PATH ||
    path.join(__dirname, '..', '..', 'secrets', 'langame.p12'),

  /** Пароль от .p12-файла (пустая строка, если сертификат без пароля). */
  pfxPassphrase: process.env.LANGAME_PFX_PASSPHRASE || '',

  /** Логин/пароль для автоматического входа при протухшей сессии. */
  login: process.env.LANGAME_LOGIN || null,
  password: process.env.LANGAME_PASSWORD || null,

  /**
   * Standalone серверный API-ключ (публичный API, без mTLS).
   * Передаётся в заголовке X-Request-Token.
   * Нужен для зон/типов ПК:
   *   /public_api/global/linking_pc_by_type/list
   *   /public_api/global/types_of_pc_in_clubs/list
   */
  apiKey: process.env.LANGAME_API_KEY || null,

  lang: process.env.LANGAME_LANG || 'ru',

  /** Куда складывать cookie-store с PHPSESSID. */
  sessionDir: path.join(__dirname, '..', '..', '.session'),

  timeout: Number(process.env.LANGAME_TIMEOUT || 30),
};

if (!config.baseUrl) {
  throw new Error('LANGAME_BASE_URL не задан. Укажите адрес панели клуба в .env.');
}

config.cookieFile = path.join(config.sessionDir, 'cookies.json');

module.exports = config;
