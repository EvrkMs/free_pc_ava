# free_pc_ava

Публичная страница «занятость зала» для ПК-клуба: сколько ПК свободно и занято и когда заканчивается сессия на каждом. Проект [reboot_pc](https://github.com/EvrkMs/reboot_pc) работает через публичный API LANGAME. Этот проект читает данные из веб-панели клуба, потому что открытого API для статуса ПК нет.

Адрес страницы: https://free-pc.ava-kk.ru

## Как это работает

Панель пускает только с клиентским TLS-сертификатом клуба (mTLS). Сервер читает его из файла PKCS#12 (`secrets/langame.p12`).

1. `login.js` (или `LANGAME_LOGIN`/`LANGAME_PASSWORD` в `.env`) входит в панель. Сессия (`PHPSESSID`) хранится в `.session/cookies.json`.
2. Сервер (`src/index.js`, порт 3000) раз в 15 секунд:
   - берёт список устройств из Master API панели (`directory.js`, кэш 5 минут). Токен `MASTER_TOKEN` и id клуба читаются со страницы `/all_clubs_pc/`, затем вызывается `GET /master_api/clients/all_clubs_pc/clubs/{id}/devices`;
   - берёт зоны (типы ПК) из публичного API по ключу `LANGAME_API_KEY`: `/public_api/global/linking_pc_by_type/list` и `/public_api/global/types_of_pc_in_clubs/list`. Без ключа зоны берутся из HTML `/client_is_version/`;
   - получает живой статус каждого ПК через WebSocket панели (`wsStatus.js`);
   - считает статус устройства (`free`, `busy`, `technical`, `offline`, `unknown`) и время окончания сессии;
   - отдаёт JSON на `/api/status` и страницу `src/index.html` на `/`.
3. Если сессия истекла, сервер входит заново по `LANGAME_LOGIN`/`LANGAME_PASSWORD`. Без них нужно вручную выполнить `node login.js`.

Наружу сервис публикует [caddy-docker-proxy](https://github.com/lucaslorentz/caddy-docker-proxy) по labels в `docker-compose.yml`. Caddy сам получает HTTPS-сертификат для домена.

## Запуск

Запуск в Docker описан в [DOCKER.md](DOCKER.md).

Без Docker:

```bash
cp .env.example .env      # заполнить LANGAME_BASE_URL, логин, пароль, ключи
npm ci
node login.js             # первый вход в панель
npm start                 # http://localhost:3000
```
