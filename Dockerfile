# Обычный Linux-образ — Windows больше не требуется: сертификат читается
# из файла (PKCS#12) через встроенный https-модуль Node.js, а не через
# curl.exe/Windows Cert Store.
#
# secrets/langame.p12 копируется прямо в образ. Это ОСОЗНАННЫЙ компромисс,
# допустимый только потому, что образ никогда не публикуется и не покидает
# эту машину (см. DOCKER.md) — иначе приватный ключ навсегда остаётся в
# слоях образа и достаётся оттуда тривиально.
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .
COPY secrets/client_id2250.p12 ./secrets/langame.p12

ENV LANGAME_PFX_PATH=/app/secrets/langame.p12

EXPOSE 3000
CMD ["node", "src/index.js"]
