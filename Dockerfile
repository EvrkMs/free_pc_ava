FROM node:22-alpine
WORKDIR /app
# Копируем только package.json если есть, или просто файлы
COPY . .
RUN npm install dotenv
EXPOSE 3000
CMD ["node", "server.js"]