'use strict';

const mtls = require('./mtls');
const publicApi = require('./publicApi');
const config = require('./config');

/**
 * Список устройств клуба: UUID, отображаемое имя, признак приставки (реле).
 *
 * Источник — HTML страницы /all_clubs_pc/ (та же, что видит администратор).
 * Разметка стабильно повторяется на каждый девайс:
 *   <form id="<UUID>" ... class="pc"> ... <div class="... pc_name ...">ИМЯ</div>
 * включая реле-устройства (id="rele_<ip>") и админ-ПК (id="1").
 */
function parseDirectory(html) {
  const devices = [];

  // Атрибуты <form> идут в разном порядке (у части ПК id стоит после
  // data-external-ip/data-remote-port), поэтому ищем сам открывающий тег
  // целиком и разбираем id/class внутри него, а не по фиксированной
  // подстроке "<form id=".
  const formTagRe = /<form\b([^>]*)>/g;
  const opens = [];
  let match;
  while ((match = formTagRe.exec(html))) {
    opens.push({ attrs: match[1], end: formTagRe.lastIndex });
  }

  for (let i = 0; i < opens.length; i++) {
    const { attrs, end } = opens[i];
    if (!/\bclass="pc"/.test(attrs)) continue;

    const idMatch = attrs.match(/\bid="([^"]+)"/);
    if (!idMatch) continue;
    const uuid = idMatch[1];

    const boundary = i + 1 < opens.length ? opens[i + 1].end : html.length;
    const rest = html.slice(end, boundary);
    const nameMatch = rest.match(/class="[^"]*\bpc_name\b[^"]*"[^>]*>([^<]+)</);
    const name = nameMatch ? nameMatch[1].trim() : uuid;

    devices.push({
      uuid,
      name,
      isPs: uuid.startsWith('rele_'),
      isAdmin: uuid === '1' || /^admin/i.test(name),
    });
  }

  return devices;
}

/**
 * Зона (тип ПК) со страницы /client_is_version/ — fallback, если нет API-ключа.
 */
function parseZones(html) {
  const tableStart = html.indexOf('id="js-client-is-version-table"');
  if (tableStart === -1) return { club: null, zoneByUuid: {}, zoneOrder: [] };

  const tableEnd = html.indexOf('</table>', tableStart);
  const table = html.slice(tableStart, tableEnd === -1 ? html.length : tableEnd);
  const rows = table.split('<tr data-id="').slice(1);

  let club = null;
  const zoneByUuid = {};
  const seenOrder = [];

  for (const row of rows) {
    const uuidMatch = row.match(/data-column="UUID"[\s\S]{0,300}?<span>([^<]*)<\/span>/);
    const zoneMatch = row.match(/data-column="pc_types"[\s\S]{0,400}?<span>([^<]*)<\/span>/);
    const placeMatch = row.match(/data-column="place"[\s\S]{0,300}?<span>([^<]*)<\/span>/);

    if (!club && placeMatch && placeMatch[1].trim()) club = placeMatch[1].trim();
    if (uuidMatch && uuidMatch[1] && zoneMatch && zoneMatch[1].trim()) {
      const zone = zoneMatch[1].trim();
      zoneByUuid[uuidMatch[1]] = zone;
      if (!seenOrder.includes(zone)) seenOrder.push(zone);
    }
  }

  return { club, zoneByUuid, zoneOrder: seenOrder };
}

/**
 * Зоны/типы ПК.
 * Приоритет: публичный API (X-Request-Token) → HTML-парсинг.
 */
async function resolveZones() {
  if (config.apiKey) {
    try {
      const fromApi = await publicApi.fetchZonesFromPublicApi();
      if (fromApi && fromApi.zoneByUuid && Object.keys(fromApi.zoneByUuid).length > 0) {
        return fromApi;
      }
    } catch (e) {
      console.warn('Зоны из публичного API недоступны:', e.message);
    }
  }

  try {
    const zonesRes = await mtls.request({ path: '/client_is_version/' });
    if (zonesRes.status === 200) {
      return parseZones(zonesRes.body);
    }
  } catch {
    // не критично
  }

  return { club: null, zoneByUuid: {}, zoneOrder: [], metaByUuid: {} };
}

/**
 * Параметры Master API со страницы панели: токен, базовый URL и id клуба.
 * Страница больше не содержит карточек ПК, их рисует /all_clubs_pc/devices.js
 * из ответа Master API.
 */
function parsePageMeta(html) {
  const meta = (name) => {
    const m = html.match(new RegExp(`<meta\\s+name="${name}"\\s+content="([^"]*)"`));
    return m ? m[1] : null;
  };
  const clubMatch = html.match(/ALL_CLUBS_PC_CLUB_ID\s*=\s*['"]?(\d+)/);
  return {
    token: meta('MASTER_TOKEN'),
    apiUrl: meta('MASTER_API_URL'),
    clubId: clubMatch ? clubMatch[1] : null,
  };
}

async function masterApiGet(apiUrl, token, uri) {
  const res = await mtls.request({
    path: apiUrl.replace(/\/$/, '') + uri,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      Language: config.lang || 'ru',
    },
  });
  if (res.status !== 200) {
    throw new Error(`Master API ${uri}: HTTP ${res.status}`);
  }
  const json = JSON.parse(res.body);
  if (json.error_code !== undefined && json.error_code !== 0) {
    throw new Error(`Master API ${uri}: ${json.error_message || 'error_code ' + json.error_code}`);
  }
  return json;
}

/**
 * Ответ GET /clients/all_clubs_pc/clubs/{id}/devices:
 *   item.devices[]: { uuid, name, is_ps, ... }
 *   item.admin_pc: { uuid, name }
 *   item.terminals[]: { uuid, name } (терминалы оплаты, не места для гостей)
 */
function parseDevicesResponse(item) {
  const devices = [];
  for (const d of (item && item.devices) || []) {
    if (!d || !d.uuid) continue;
    const uuid = String(d.uuid);
    const name = (d.name || '').trim() || uuid;
    devices.push({
      uuid,
      name,
      isPs: !!d.is_ps || uuid.startsWith('rele_'),
      isAdmin: /^admin/i.test(name),
    });
  }
  if (item && item.admin_pc && item.admin_pc.uuid) {
    devices.push({
      uuid: String(item.admin_pc.uuid),
      name: item.admin_pc.name || 'admin',
      isPs: false,
      isAdmin: true,
    });
  }
  return devices;
}

/** Список устройств через Master API (текущая версия панели). */
async function fetchDevicesFromMasterApi(html) {
  const { token, apiUrl, clubId: pageClubId } = parsePageMeta(html);
  if (!token || !apiUrl) {
    throw new Error('На странице /all_clubs_pc/ нет MASTER_TOKEN или MASTER_API_URL.');
  }

  let clubId = pageClubId;
  let clubName = null;
  try {
    const clubs = await masterApiGet(apiUrl, token, '/clubs/active');
    const list = (clubs.items || []).filter((c) => c && c.id && Number(c.id) !== 0);
    list.sort((a, b) => Number(a.id) - Number(b.id));
    const current = list.find((c) => String(c.id) === String(clubId)) || list[0];
    if (current) {
      clubId = String(current.id);
      clubName = current.name || null;
    }
  } catch (e) {
    if (!clubId) throw e;
  }
  if (!clubId) throw new Error('Не удалось определить id клуба для /all_clubs_pc/.');

  const res = await masterApiGet(
    apiUrl,
    token,
    `/clients/all_clubs_pc/clubs/${encodeURIComponent(clubId)}/devices`,
  );
  return { clubName, devices: parseDevicesResponse(res.item) };
}

async function fetchDirectory() {
  const res = await mtls.request({ path: '/all_clubs_pc/' });
  if (res.status !== 200) {
    throw new Error(`Не удалось получить /all_clubs_pc/: HTTP ${res.status}`);
  }

  // Старая вёрстка с карточками в HTML: оставлена как запасной вариант.
  let devices = parseDirectory(res.body);
  let clubName = null;
  if (devices.length === 0) {
    ({ devices, clubName } = await fetchDevicesFromMasterApi(res.body));
  }
  if (devices.length === 0) {
    throw new Error('Master API /all_clubs_pc/ вернул пустой список устройств.');
  }

  const zones = await resolveZones();
  const { zoneByUuid, zoneOrder = [], metaByUuid = {} } = zones;
  const club = zones.club || clubName;

  for (const device of devices) {
    const meta = metaByUuid[device.uuid];
    if (meta) {
      if (meta.isPs) device.isPs = true;
      // имя из API — только если HTML не дал нормального
      if (meta.name && (!device.name || device.name === device.uuid)) {
        device.name = meta.name;
      }
    }

    device.zone =
      zoneByUuid[device.uuid] ||
      (device.isPs ? 'Приставки' : null);
  }

  return { club, devices, zoneOrder };
}

module.exports = {
  fetchDirectory,
  parseDirectory,
  parseZones,
  parsePageMeta,
  parseDevicesResponse,
};
