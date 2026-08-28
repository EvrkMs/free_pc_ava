'use strict';

const WebSocket = require('ws');

const config = require('./config');
const { getTlsOptions, cookieHeader } = require('./mtls');

/**
 * Живой статус устройств идёт только через WebSocket панели (wss:///wss/) —
 * обычный HTTP-запрос отдаёт пустой шаблон, значения дорисовывает браузер
 * после обмена с сокетом. Подключаемся напрямую пакетом `ws`, передавая тот
 * же клиентский PKCS#12-сертификат, что и в mtls.js (заменяет прежний
 * .NET ClientWebSocket из PowerShell).
 *
 * Для каждого UUID отправляем `command_api showConfig` и слушаем ответы —
 * так делает сама панель (см. send2WSall() в её HTML).
 *
 * В отличие от PowerShell 5.1 (у которого ConvertFrom-Json падал на ключах,
 * различающихся только регистром, из-за чего пришлось вытаскивать поля
 * точечными регексами), обычный JSON.parse в Node такой проблемы не имеет —
 * разбираем ответ панели целиком.
 */

function randomId(len = 24) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function fetchLiveStatus(uuids, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    if (uuids.length === 0) {
      resolve({});
      return;
    }

    const host = config.baseUrl.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    const cookie = cookieHeader();
    const sessMatch = cookie.match(/PHPSESSID=([^;]+)/);
    if (!sessMatch) {
      reject(new Error('PHPSESSID не найден — нужен вход (node login.js).'));
      return;
    }
    const sessionId = `${sessMatch[1]}_${randomId()}`;

    let ws;
    try {
      ws = new WebSocket(`wss://${host}/wss/?client_guid=${sessionId}&type_client=browser`, {
        ...getTlsOptions(),
        headers: { Cookie: cookie, Origin: `https://${host}` },
        handshakeTimeout: 8000,
      });
    } catch (e) {
      reject(e);
      return;
    }

    const results = {};
    let settled = false;
    const deadline = setTimeout(finish, timeoutMs);

    function finish() {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      try {
        ws.close();
      } catch {
        // сокет уже мог закрыться сам — не критично
      }
      resolve(results);
    }

    function fail(err) {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      reject(err);
    }

    ws.on('open', () => {
      uuids.forEach((uuid, i) => {
        setTimeout(() => {
          if (ws.readyState !== WebSocket.OPEN) return;
          ws.send(
            JSON.stringify({
              client_guid: uuid,
              type: 'command_api',
              command: 'showConfig',
              who_send: sessionId,
              need_return: true,
            }),
          );
        }, i * 200);
      });
    });

    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString('utf8'));
      } catch {
        return;
      }
      if (msg && msg.UUID) {
        results[msg.UUID] = msg;
        if (Object.keys(results).length >= uuids.length) finish();
      }
    });

    ws.on('error', (err) => fail(err));
    ws.on('close', () => finish());
  });
}

module.exports = { fetchLiveStatus };
