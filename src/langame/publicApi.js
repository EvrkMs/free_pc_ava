'use strict';

const https = require('node:https');
const { URL } = require('node:url');
const config = require('./config');

/**
 * Клиент публичного API LANGAME (Standalone).
 * Не требует клиентского TLS-сертификата — только заголовок X-Request-Token.
 *
 * Документация (OpenAPI):
 *   GET /public_api/global/linking_pc_by_type/list
 *   GET /public_api/global/types_of_pc_in_clubs/list
 */

function request(path) {
  if (!config.apiKey) {
    return Promise.reject(
      new Error(
        'LANGAME_API_KEY не задан. Добавьте Standalone серверный API-ключ в .env ' +
          '(заголовок X-Request-Token).',
      ),
    );
  }

  const base = (config.baseUrl || 'https://226.langame.ru').replace(/\/$/, '');
  const url = new URL(base + '/public_api' + path);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: 'GET',
        headers: {
          'X-Request-Token': config.apiKey,
          Accept: 'application/json',
        },
        timeout: (config.timeout || 30) * 1000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode === 403) {
            reject(
              new Error(
                'Публичный API: 403 Forbidden — ключ не передан, недействителен ' +
                  'или нет доступа к ресурсу.',
              ),
            );
            return;
          }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`Публичный API ${path}: HTTP ${res.statusCode}`));
            return;
          }
          try {
            const json = JSON.parse(body);
            if (json && json.status === false) {
              reject(new Error(`Публичный API ${path}: status=false`));
              return;
            }
            resolve(json);
          } catch (e) {
            reject(new Error(`Публичный API ${path}: невалидный JSON`));
          }
        });
      },
    );

    req.on('timeout', () =>
      req.destroy(new Error(`Таймаут публичного API (${config.timeout || 30}s)`)),
    );
    req.on('error', reject);
    req.end();
  });
}

/**
 * Список типов ПК в клубах.
 * @returns {Promise<Array<{id:number, name:string|null, name_en:string|null, sort:number, color:string|null}>>}
 */
async function fetchPcTypes() {
  const json = await request('/global/types_of_pc_in_clubs/list');
  return Array.isArray(json.data) ? json.data : [];
}

/**
 * Привязка ПК по типам (UUID → packets_type_PC и др.).
 * @returns {Promise<Array<object>>}
 */
async function fetchLinkingByType() {
  const json = await request('/global/linking_pc_by_type/list');
  return Array.isArray(json.data) ? json.data : [];
}

/**
 * Собирает карту UUID → название зоны (типа ПК), порядок зон и meta по UUID.
 *
 * packets_type_PC из linking → name из types (по id).
 * isPS=1 без типа → «Приставки».
 * zoneOrder — имена типов, отсортированные по полю sort (для UI).
 *
 * @returns {Promise<{
 *   club: string|null,
 *   zoneByUuid: Record<string, string>,
 *   zoneOrder: string[],
 *   metaByUuid: Record<string, { isPs: boolean, typeId: number|null, name: string|null }>
 * }>}
 */
async function fetchZonesFromPublicApi() {
  const [types, linking] = await Promise.all([fetchPcTypes(), fetchLinkingByType()]);

  // id → { name, sort }
  const typeById = new Map();
  for (const t of types) {
    if (t == null || t.id == null) continue;
    const name =
      (t.name && String(t.name).trim()) ||
      (t.name_en && String(t.name_en).trim()) ||
      null;
    if (!name) continue;
    typeById.set(Number(t.id), {
      name,
      sort: Number.isFinite(Number(t.sort)) ? Number(t.sort) : 9999,
    });
  }

  // Порядок зон по sort из справочника типов
  const zoneOrder = [...typeById.values()]
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'ru'))
    .map((t) => t.name);

  // «Приставки» в конец, если появятся
  if (!zoneOrder.includes('Приставки')) zoneOrder.push('Приставки');

  const zoneByUuid = {};
  const metaByUuid = {};

  for (const row of linking) {
    if (!row || !row.UUID) continue;
    const uuid = String(row.UUID).trim();
    if (!uuid) continue;

    const typeId = row.packets_type_PC != null ? Number(row.packets_type_PC) : null;
    const isPs = row.isPS === 1 || row.isPS === '1' || row.isPS === true;
    const deviceName =
      (row.name && String(row.name).trim()) ||
      (row.fiscal_name && String(row.fiscal_name).trim()) ||
      null;

    let zone = null;
    if (typeId != null && typeById.has(typeId)) {
      zone = typeById.get(typeId).name;
    } else if (isPs) {
      zone = 'Приставки';
    }

    if (zone) zoneByUuid[uuid] = zone;

    metaByUuid[uuid] = { isPs, typeId, name: deviceName };
  }

  return { club: null, zoneByUuid, zoneOrder, metaByUuid };
}

module.exports = {
  fetchPcTypes,
  fetchLinkingByType,
  fetchZonesFromPublicApi,
};
