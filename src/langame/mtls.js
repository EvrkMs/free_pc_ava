'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const config = require('./config');
const { resolveCertRef } = require('./cert');

/**
 * HTTP-транспорт поверх curl.exe (сборка со Schannel).
 *
 * Почему не встроенный в Node https: приватный ключ сертификата помечен
 * non-exportable, вытащить его в pem/pfx нельзя в принципе. Только
 * Schannel/CNG умеет подписать TLS handshake, не отдавая ключ наружу.
 * curl.exe со Schannel это умеет через ссылку вида `CurrentUser\MY\<отпечаток>`
 * — ключ так и остаётся в хранилище Windows. Поэтому весь этот модуль
 * (и, соответственно, авторизация к 226.langame.ru) работает только на
 * Windows-машине, где сертификат установлен — не в Linux-контейнере.
 */

let cachedCertRef = null;

function certRef() {
  if (!cachedCertRef) cachedCertRef = resolveCertRef();
  return cachedCertRef;
}

function ensureJar() {
  fs.mkdirSync(config.sessionDir, { recursive: true });
  if (!fs.existsSync(config.cookieJar)) {
    fs.writeFileSync(config.cookieJar, '# Netscape HTTP Cookie File\n', 'utf8');
  }
  return config.cookieJar;
}

/** Из дампа заголовков берём последний HTTP-ответ (перед ним может быть 200 от CONNECT прокси). */
function parseHeaderDump(dump) {
  const blocks = dump
    .split(/\r?\n\r?\n/)
    .map((b) => b.trim())
    .filter((b) => /^HTTP\//i.test(b));

  const last = blocks[blocks.length - 1] || '';
  const lines = last.split(/\r?\n/);
  const statusLine = lines.shift() || '';
  const status = Number((statusLine.match(/^HTTP\/[\d.]+\s+(\d{3})/i) || [])[1] || 0);

  const headers = {};
  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const name = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    headers[name] = headers[name] ? headers[name] + ', ' + value : value;
  }

  return { status, headers, statusLine };
}

/**
 * Выполнить запрос.
 *
 * @param {object} opts
 * @param {string} opts.path путь вида '/auth.php' или полный URL
 * @param {string} [opts.method] GET по умолчанию
 * @param {string} [opts.body] тело запроса; передаётся через stdin
 * @param {object} [opts.headers]
 * @returns {{status:number, headers:object, body:string, location:(string|null)}}
 */
function request(opts) {
  const {
    path: reqPath,
    method = 'GET',
    body = null,
    headers = {},
  } = opts;

  const url = /^https?:\/\//i.test(reqPath) ? reqPath : config.baseUrl + reqPath;
  const jar = ensureJar();
  const headerFile = path.join(
    os.tmpdir(),
    'freepc-hdr-' + crypto.randomBytes(8).toString('hex') + '.txt',
  );

  const args = [
    '--silent',
    '--show-error',
    '--globoff',
    '--cert', certRef(),
    '--cookie', jar,
    '--cookie-jar', jar,
    '--max-time', String(config.timeout),
    '--dump-header', headerFile,
    '--request', method,
  ];

  for (const [name, value] of Object.entries(headers)) {
    args.push('--header', `${name}: ${value}`);
  }

  if (body !== null) {
    if (!headers['Content-Type'] && !headers['content-type']) {
      args.push('--header', 'Content-Type: application/x-www-form-urlencoded');
    }
    args.push('--data-binary', '@-');
  }

  args.push(url);

  try {
    const res = spawnSync('curl.exe', args, {
      input: body === null ? undefined : body,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    });

    if (res.error) throw res.error;
    if (res.status !== 0) {
      throw new Error(
        `curl завершился с кодом ${res.status}: ${(res.stderr || '').trim() || 'нет вывода'}`,
      );
    }

    const dump = fs.existsSync(headerFile) ? fs.readFileSync(headerFile, 'utf8') : '';
    const { status, headers: respHeaders } = parseHeaderDump(dump);

    return {
      status,
      headers: respHeaders,
      body: res.stdout || '',
      location: respHeaders.location || null,
    };
  } finally {
    fs.rmSync(headerFile, { force: true });
  }
}

function clearSession() {
  fs.rmSync(config.cookieJar, { force: true });
}

module.exports = { request, clearSession, certRef };
