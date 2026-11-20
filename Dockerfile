# Сертификат панели (PKCS#12) копируется в образ вместе с папкой secrets/.
# Файл выбирает LANGAME_PFX_PATH из .env (по умолчанию secrets/langame.p12).
#
# Приватный ключ остаётся в слоях образа. Образ нельзя пушить в реестр
# и переносить на другой хост (см. DOCKER.md).
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3000
CMD ["node", "src/index.js"]
