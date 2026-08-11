'use strict';

const auth = require('./auth');
const directory = require('./directory');
const wsStatus = require('./wsStatus');

// Справочник устройств (номера/имена/UUID) практически не меняется —
// перечитывать и заново парсить ~400 КБ HTML на каждый 15-секундный цикл
// смысла нет, поэтому кешируем его отдельно и надолго.
const DIRECTORY_TTL = 5 * 60 * 1000;
let directoryCache = { club: null, devices: null, expires: 0 };

/** Извлекает номер из "PC12" -> 12. Для остального (PS1, ADMIN PC) возвращает null. */
function extractNumber(name) {
  const m = name.match(/^PC(\d+)$/i);
  return m ? Number(m[1]) : null;
}

/** Понимает и JSON-булевы значения, и числовые 0/1, которые иногда встречаются в ответах панели. */
function toBool(v) {
  if (v === true || v === 'true' || v === 'True') return true;
  if (v === false || v === 'false' || v === 'False' || v === null || v === undefined) return false;
  const n = Number(v);
  return Number.isFinite(n) ? n !== 0 : false;
}

function getDirectory() {
  if (directoryCache.devices && Date.now() < directoryCache.expires) {
    return directoryCache;
  }
  const { club, devices: allDevices } = directory.fetchDirectory();
  const devices = allDevices.filter((d) => !d.isAdmin);
  directoryCache = { club, devices, expires: Date.now() + DIRECTORY_TTL };
  return directoryCache;
}

/** free/busy/technical/offline — устройство ответило; unknown — не ответило на этом цикле опроса. */
function computeStatus(info) {
  if (!info) return 'unknown';
  if (toBool(info.is_OfflineMode)) return 'offline';
  if (toBool(info.tehnicalTime)) return 'technical';
  if (info.state === 'free') return 'free';
  if (info.state === 'session_active') return 'busy';
  return 'unknown';
}

function computeAll() {
  const { club, devices } = getDirectory();
  const live = wsStatus.fetchLiveStatus(devices.map((d) => d.uuid));

  const pcs = devices.map((device) => {
    const info = live[device.uuid] || null;
    const status = computeStatus(info);

    return {
      uuid: device.uuid,
      number: extractNumber(device.name),
      name: device.name,
      isPs: device.isPs,
      zone: device.zone,
      status,
      // Время окончания сессии (обычно "ЧЧ:ММ", иногда служебное значение
      // вроде "manual_unlock", если гость снят с таймера вручную). Оставшиеся
      // минуты сервер не считает и не хранит — это время устаревает мгновенно
      // после каждого опроса и к тому же иногда приходит от панели откровенно
      // битым (наблюдался remainTime за миллионы минут на одном ПК). Секунда
      // в секунду досчитать до endsAt проще и надёжнее на стороне клиента.
      endsAt: status === 'busy' ? info.endOfTimeText : null,
    };
  });

  return { club, pcs };
}

/**
 * Итоговый статус клуба:
 *   { club, pcs: [{ uuid, number, name, isPs, zone, status, endsAt }] }
 *
 * status — 'free' | 'busy' | 'technical' | 'offline' | 'unknown'
 *   ('unknown' — устройство не ответило на опрос за это окно, а не факт занятости)
 * endsAt — время окончания сессии ("ЧЧ:ММ" или служебное значение), только
 *   для status === 'busy'; сколько осталось — считает клиент по своим часам.
 *
 * Требует активной сессии в панели (node login.js) и работает только на
 * этой Windows-машине — сертификат клуба не экспортируется из хранилища.
 *
 * Сессию проактивно не проверяем на каждый вызов (это отдельный HTTP-запрос
 * через curl.exe) — только если сам сбор данных упал, тогда пробуем
 * авторизоваться и повторить один раз.
 */
function getStatus() {
  try {
    return computeAll();
  } catch (e) {
    auth.ensureAuthenticated();
    directoryCache = { club: null, devices: null, expires: 0 };
    return computeAll();
  }
}

module.exports = { getStatus };
