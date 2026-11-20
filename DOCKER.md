# Docker для free_pc_ava

Образ собран на `node:20-alpine`. Сертификат панели (PKCS#12) Node читает из файла: `https.Agent({ pfx, passphrase })` для HTTP и пакет `ws` для WebSocket.

## Сертификат

При сборке `COPY . .` копирует папку `secrets/` в образ. Файл выбирает переменная `LANGAME_PFX_PATH` из `.env`: имя файла в `secrets/` (`client_id2250.p12`) или путь к нему. По умолчанию используется `secrets/langame.p12`.

Смена сертификата: положить новый файл в `./secrets`, поправить `LANGAME_PFX_PATH`, выполнить `docker compose up -d --build`.

Приватный ключ остаётся в слоях образа: его можно достать через `docker save`, из реестра или из бэкапа. Поэтому образ нельзя пушить в Docker Hub, GHCR или другой реестр и нельзя переносить на другой хост.

## Публикация через Caddy

Контейнер подключается к внешней docker-сети `caddy` (имя меняется через `CADDY_NETWORK` в `.env`). caddy-docker-proxy читает labels сервиса:

```yaml
labels:
  caddy: free-pc.ava-kk.ru
  caddy.reverse_proxy: "{{upstreams 3000}}"
```

Перед запуском нужны:
- сеть `caddy` и работающий в ней контейнер caddy-docker-proxy;
- A-запись `free-pc.ava-kk.ru` на IP этого сервера.

## Запуск

```bash
# 1. Сертификат
mkdir -p secrets
cp /путь/к/сертификату.p12 secrets/

# 2. Настройки: LANGAME_BASE_URL, LANGAME_PFX_PATH, LANGAME_LOGIN,
#    LANGAME_PASSWORD, LANGAME_PFX_PASSPHRASE, LANGAME_API_KEY
cp .env.example .env

# 3. Сборка и первый вход (сессия сохраняется в volume session-data)
docker compose build
docker compose run --rm langame-status node login.js

# 4. Запуск
docker compose up -d
```

Проверить сессию в работающем контейнере:

```bash
docker compose exec langame-status node login.js --check
```

`docker stop` завершает контейнер за 1 или 2 секунды: в compose включён `init: true`, а `src/index.js` обрабатывает `SIGTERM`.
