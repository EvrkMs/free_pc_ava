# Сертификат панели (PKCS#12) в образ не попадает. docker-compose.yml
# монтирует ./secrets в /app/secrets, а путь к файлу задаёт LANGAME_PFX_PATH
# из .env (по умолчанию secrets/langame.p12).
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3000
CMD ["node", "src/index.js"]
