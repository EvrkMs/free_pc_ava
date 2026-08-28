'use strict';

const https = require('node:https');
const fs = require('node:fs');
const { URL } = require('node:url');

const config = require('./config');

/**
 * HTTP-транспорт на встроенном https-модуле Node.js с клиентским
 * TLS-сертификатом в формате PKCS#12 (.p12/.pfx).
 *
 * Заменяет прежний транспорт через curl.exe + Schannel/Windows Cert Store.
 * Кросс-платформенно: сертификат читается из файла, приватный ключ никуда
 * не уходит из процесса (и не покидает контейнер, если .p12 не смонтирован
 * снаружи, а запечён в образ — см. DOCKER.md).
 */

let pfxBuffer = null;
function loadPfx() {
  if (pfxBuffer) return pfxBuffer;
  if (!fs.existsSync(config.pfxPath)) {
    throw new Error(
      `Сертификат не найден: ${config.pfxPath}\n` +
        'Задайте LANGAME_PFX_PATH или положите файл по этому пути.',
    );
  }
  pfxBuffer = fs.readFileSync(config.pfxPath);
  return pfxBuffer;
}

/** TLS-опции для клиентского сертификата — переиспользуются в wsStatus.js для WebSocket. */
function getTlsOptions() {
  return { pfx: loadPfx(), passphrase: config.pfxPassphrase };
}

let agent = null;
function getAgent() {
  if (!agent) {
    agent = new https.Agent({ ...getTlsOptions(), keepAlive: true });
  }
  return agent;
}

function ensureStore() {
  fs.mkdirSync(config.sessionDir, { recursive: true });
  if (!fs.existsSync(config.cookieFile)) {
    fs.writeFileSync(config.cookieFile, '{}', 'utf8');
  }
}

function loadCookies() {
  ensureStore();
  try {
    return JSON.parse(fs.readFileSync(config.cookieFile, 'utf8'));
  } catch {
    return {};
  }
}

function saveCookies(cookies) {
  fs.writeFileSync(config.cookieFile, JSON.stringify(cookies), 'utf8');
}

function applySetCookie(setCookieHeader) {
  if (!setCookieHeader) return;
  const cookies = loadCookies();
  const list = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  for (const raw of list) {
    const pair = raw.split(';')[0];
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    cookies[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
  saveCookies(cookies);
}

/** Собранный Cookie-заголовок из локального cookie-store (см. cookieFile). */
function cookieHeader() {
  const cookies = loadCookies();
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

/**
 * Выполнить запрос.
 *
 * @param {object} opts
 * @param {string} opts.path путь вида '/auth.php' или полный URL
 * @param {string} [opts.method] GET по умолчанию
 * @param {string} [opts.body] тело запроса
 * @param {object} [opts.headers]
 * @returns {Promise<{status:number, headers:object, body:string, location:(string|null)}>}
 */
function request(opts) {
  const { path: reqPath, method = 'GET', body = null, headers = {} } = opts;
  const url = new URL(/^https?:\/\//i.test(reqPath) ? reqPath : config.baseUrl + reqPath);

  const reqHeaders = { ...headers };
  const cookie = cookieHeader();
  if (cookie) reqHeaders.Cookie = cookie;
  if (body !== null) {
    if (!reqHeaders['Content-Type'] && !reqHeaders['content-type']) {
      reqHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    reqHeaders['Content-Length'] = Buffer.byteLength(body);
  }

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        agent: getAgent(),
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method,
        headers: reqHeaders,
        timeout: config.timeout * 1000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          applySetCookie(res.headers['set-cookie']);
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
            location: res.headers.location || null,
          });
        });
      },
    );

    req.on('timeout', () => req.destroy(new Error(`Таймаут запроса (${config.timeout}s)`)));
    req.on('error', reject);
    if (body !== null) req.write(body);
    req.end();
  });
}

function clearSession() {
  fs.rmSync(config.cookieFile, { force: true });
}

module.exports = { request, clearSession, getTlsOptions, cookieHeader };
