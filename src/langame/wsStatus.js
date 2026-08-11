'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const config = require('./config');
const { certRef } = require('./mtls');

const SCRIPT_PATH = path.join(__dirname, 'wsStatus.ps1');

/**
 * Живой статус устройств идёт только через WebSocket панели (wss:///wss/) —
 * обычный HTTP-запрос отдаёт пустой шаблон, значения дорисовывает браузер
 * после обмена с сокетом. Подключаемся через .NET ClientWebSocket в
 * PowerShell: он умеет использовать клиентский сертификат прямо из
 * хранилища Windows (как и curl.exe в mtls.js), но, в отличие от curl,
 * нормально держит двусторонний WS-обмен.
 *
 * Для каждого UUID отправляем `command_api showConfig` и слушаем ответы —
 * так делает сама панель (см. send2WSall() в её HTML).
 */
const HTTP_ONLY_PREFIX = '#HttpOnly_';

function readPhpSessId(host) {
  const jar = fs.readFileSync(config.cookieJar, 'utf8');

  for (const rawLine of jar.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    // curl помечает HttpOnly-куки строкой вида "#HttpOnly_<domain>\t...", а
    // PHPSESSID почти всегда HttpOnly — просто пропускать все строки с "#"
    // (как выглядят обычные комментарии jar-файла) означает никогда не найти
    // такую куку.
    if (line.startsWith('#') && !line.startsWith(HTTP_ONLY_PREFIX)) continue;
    const cleaned = line.startsWith(HTTP_ONLY_PREFIX) ? line.slice(HTTP_ONLY_PREFIX.length) : line;

    const cols = cleaned.split('\t');
    if (cols.length < 7) continue;
    const [domain, , , , , name, value] = cols;
    if (name === 'PHPSESSID' && domain.replace(/^\./, '') === host) {
      return value;
    }
  }

  throw new Error('PHPSESSID не найден в cookie-jar — нужен вход (node login.js).');
}

/** Отпечаток сертификата из ссылки вида "CurrentUser\MY\<отпечаток>" (в любом формате разделителей). */
function extractThumbprint(certRefValue) {
  const hex = certRefValue.match(/[0-9A-Fa-f]{40}/);
  if (hex) return hex[0];
  return certRefValue.replace(/^.*[\\/]/, '');
}

function fetchLiveStatus(uuids, { timeoutMs = 15000 } = {}) {
  const baseHost = config.baseUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const phpSessId = readPhpSessId(baseHost);

  const res = spawnSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT_PATH,
    '-Thumbprint', extractThumbprint(certRef()),
    '-PHPSESSID', phpSessId,
    '-BaseHost', baseHost,
    '-UuidsJson', JSON.stringify(uuids),
    '-TimeoutMs', String(timeoutMs),
  ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: timeoutMs + 15000 });

  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error('wsStatus.ps1 завершился с ошибкой: ' + (res.stderr || '').trim());
  }

  let list;
  try {
    list = JSON.parse(res.stdout || '[]');
  } catch {
    throw new Error('wsStatus.ps1 вернул не-JSON: ' + (res.stdout || '').slice(0, 300));
  }
  if (!Array.isArray(list)) list = [list];

  const byUuid = {};
  for (const item of list) {
    if (item && item.UUID) byUuid[item.UUID] = item;
  }
  return byUuid;
}

module.exports = { fetchLiveStatus };
