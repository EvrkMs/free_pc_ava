# free_pc_ava

Публичный виджет «занятость зала» для ПК-клуба: сколько ПК свободно/занято и когда заканчивается текущая сессия на каждом. В отличие от [reboot_pc](https://github.com/EvrkMs/reboot_pc), который дёргает документированный публичный API LANGAME, этот проект читает данные из самой веб-панели клуба (`226.langame.ru`) — того же интерфейса, что видит администратор, без открытого API под это.

## Почему так сложно устроено

Панель LANGAME пускает только по клиентскому TLS-сертификату (mTLS), выданному конкретному клубу. Приватный ключ сертификата лежит в хранилище Windows (`Cert:\CurrentUser\My`) с пометкой non-exportable — вытащить его в файл нельзя даже сознательно, поэтому вся эта часть работает только на Windows-машине клуба, где сертификат установлен, и только через инструменты, умеющие обращаться к сертификату по ссылке (Schannel/CNG), а не по самому ключу:

- HTTP — через `curl.exe` (Schannel-сборка), передавая ссылку на сертификат `CurrentUser\MY\<отпечаток>` (`src/langame/mtls.js`).
- Живой статус ПК панель отдаёт только по WebSocket (`wss:///wss/`) — обычный HTTP отдаёт пустой шаблон, значения дорисовывает браузер после обмена с сокетом. Curl двусторонний WS не тянет, поэтому для этого отдельно запускается PowerShell-скрипт (`wsStatus.ps1`) через `.NET ClientWebSocket`, который тоже умеет забрать сертификат из хранилища.

## Как это работает

1. `login.js` (или `LANGAME_LOGIN`/`LANGAME_PASSWORD` в `.env`) один раз логинится в панель, сессия (`PHPSESSID`) сохраняется в `.session/cookies.json`.
2. Локальный сервер (`src/index.js`, порт 3000) каждые 15 секунд:
   - берёт список устройств клуба из HTML `/all_clubs_pc/` (`directory.js`, кэш 5 минут);
   - зоны/типы ПК — из публичного API (`LANGAME_API_KEY` → `X-Request-Token`):
     `/public_api/global/linking_pc_by_type/list` + `/public_api/global/types_of_pc_in_clubs/list`
     (без mTLS; при отсутствии ключа — fallback на HTML `/client_is_version/`);
   - опрашивает живой статус каждого UUID через WS (`wsStatus.js`);
   - считает итоговый статус на устройство: `free` / `busy` / `technical` / `offline` / `unknown`, и для занятых — время окончания сессии;
   - отдаёт всё как JSON на `/api/status` (плюс простую HTML-страницу).
3. Если сессия протухла — сервер сам логинится заново (при наличии `LANGAME_LOGIN`/`LANGAME_PASSWORD`), иначе просит выполнить `node login.js` вручную.

## Публичный виджет (Cloudflare Worker)

`worker/` — отдельный Cloudflare Worker: раздаёт статику виджета (`worker/public/`) и проксирует `/api/status` на локальный сервер клуба через Cloudflare Tunnel (VPC Service, `wrangler vpc service`). Сертификат и сессия остаются только на машине клуба — наружу утекают уже готовые данные о занятости, а не доступ к панели.

## Запуск

Локальный сервер (на машине клуба, где стоит сертификат):

```bash
cp .env.example .env
# в .env:
#   LANGAME_LOGIN / LANGAME_PASSWORD — автологин при протухшей сессии
#   LANGAME_API_KEY — Standalone ключ (X-Request-Token) для зон/типов ПК
#   LANGAME_PFX_PASSPHRASE — если .p12 с паролем
node login.js             # первый вход в панель
npm start                 # или start.bat
```

Публичный виджет (Cloudflare):

```bash
cd worker
wrangler deploy
```

`service_id` в `worker/wrangler.toml` должен указывать на VPC Service, настроенный на `http://127.0.0.1:3000` того же клубного хоста.
