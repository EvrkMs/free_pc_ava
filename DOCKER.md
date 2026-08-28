# Docker для free_pc_ava (backend)

## Что изменилось

Раньше backend (`src/index.js`) работал только на Windows: авторизация к
`226.langame.ru` шла через `curl.exe`/`powershell.exe`, обращавшиеся к
клиентскому mTLS-сертификату в `Cert:\CurrentUser\My`, ключ которого был
`non-exportable`.

Теперь используется клиентский сертификат в формате **PKCS#12 (.p12)**,
который Node читает напрямую (`https.Agent({ pfx, passphrase })` и пакет
`ws` для WebSocket-статуса). Windows, curl.exe и PowerShell больше не
нужны — обычный Linux-образ, обычный `docker compose`.

`worker/` (Cloudflare Worker) этим изменением не затронут — он как деплоился
через `wrangler deploy` на edge, так и деплоится, сертификат ему не нужен.

## Сертификат в образе — осознанный компромисс

`Dockerfile` копирует `secrets/langame.p12` прямо в образ (`COPY`). Это
означает, что приватный ключ остаётся в слоях образа навсегда: даже если
удалить файл в следующем `RUN`-шаге, слой с ним никуда не денется, и любой
с доступом к образу (`docker save`, pull из реестра, бэкап) может достать
ключ обратно.

Это приемлемо, только если образ **никогда не покидает эту машину**: не
пушится в Docker Hub/GHCR/приватный registry, не бэкапится целиком, не
переносится на другой хост как есть. Если это когда-нибудь перестанет быть
так — вместо `COPY` в `Dockerfile` нужно перейти на монтирование секрета
через volume при старте контейнера (`docker-compose.yml` → добавить
`volumes: - ./secrets/langame.p12:/app/secrets/langame.p12:ro` вместо
`COPY secrets/langame.p12 ...` в Dockerfile) — тогда секрет не попадает в
слои образа вообще.

## Запуск

```bash
# 1. Положить сертификат
mkdir -p secrets
cp /путь/к/вашему/langame.p12 secrets/langame.p12

# 2. Настроить .env
cp .env.example .env
# заполнить LANGAME_LOGIN, LANGAME_PASSWORD, LANGAME_PFX_PASSPHRASE

# 3. Собрать образ
docker compose build

# 4. Первый вход (создаёт сессию в volume session-data)
docker compose run --rm langame-status node login.js

# 5. Запуск
docker compose up -d
```

Проверить сессию без пересоздания контейнера:

```bash
docker compose exec langame-status node login.js --check
```

## Локальная разработка виджета (Cloudflare Worker)

Не связана с сертификатом, отдельный compose-файл:

```bash
docker compose -f docker-compose.dev.yml up --build
# -> http://localhost:8787
```

`/api/status` в этом режиме не отвечает по-настоящему — `wrangler dev` без
`--remote` не эмулирует `vpc_services`-биндинг. Годится для проверки
статики/CORS.
