'use strict';

const mtls = require('./mtls');

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
 * Зона (тип ПК, напр. "Стандарт"/"VIP"/"Эксклюзив") и название клуба —
 * со страницы /client_is_version/ (таблица привязки ПК по типам).
 * Разметка на девайс: <tr data-id="..."> ... data-column="place"><span>КЛУБ</span>
 * ... data-column="UUID"><span>UUID</span> ... data-column="pc_types"><span>ЗОНА</span>
 */
function parseZones(html) {
  const tableStart = html.indexOf('id="js-client-is-version-table"');
  if (tableStart === -1) return { club: null, zoneByUuid: {} };

  const tableEnd = html.indexOf('</table>', tableStart);
  const table = html.slice(tableStart, tableEnd === -1 ? html.length : tableEnd);
  const rows = table.split('<tr data-id="').slice(1);

  let club = null;
  const zoneByUuid = {};

  for (const row of rows) {
    const uuidMatch = row.match(/data-column="UUID"[\s\S]{0,300}?<span>([^<]*)<\/span>/);
    const zoneMatch = row.match(/data-column="pc_types"[\s\S]{0,400}?<span>([^<]*)<\/span>/);
    const placeMatch = row.match(/data-column="place"[\s\S]{0,300}?<span>([^<]*)<\/span>/);

    if (!club && placeMatch && placeMatch[1].trim()) club = placeMatch[1].trim();
    if (uuidMatch && uuidMatch[1] && zoneMatch && zoneMatch[1].trim()) {
      zoneByUuid[uuidMatch[1]] = zoneMatch[1].trim();
    }
  }

  return { club, zoneByUuid };
}

function fetchDirectory() {
  const res = mtls.request({ path: '/all_clubs_pc/' });
  if (res.status !== 200) {
    throw new Error(`Не удалось получить /all_clubs_pc/: HTTP ${res.status}`);
  }
  const devices = parseDirectory(res.body);
  if (devices.length === 0) {
    throw new Error('На странице /all_clubs_pc/ не найдено ни одного устройства — возможно, изменилась вёрстка панели.');
  }

  // Зоны/название клуба — не критичны для основной функции страницы,
  // поэтому при сбое просто оставляем список ПК без группировки.
  let club = null;
  let zoneByUuid = {};
  try {
    const zonesRes = mtls.request({ path: '/client_is_version/' });
    if (zonesRes.status === 200) ({ club, zoneByUuid } = parseZones(zonesRes.body));
  } catch {
    // не критично — см. комментарий выше
  }

  for (const device of devices) {
    device.zone = zoneByUuid[device.uuid] || (device.isPs ? 'Приставки' : null);
  }

  return { club, devices };
}

module.exports = { fetchDirectory, parseDirectory, parseZones };
