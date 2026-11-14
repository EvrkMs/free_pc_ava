const http = require('http');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const auth = require('./langame/auth');
const pcStatus = require('./langame/pcStatus');

const PORT = 3000;
const CACHE_TTL = 15000; // 15 секунд кеша

// club/pcs — последнее известное состояние (переживает неудачные обновления,
// чтобы страница показывала последнее известное состояние, а не падала целиком).
// ok/error/updatedAt отражают РЕЗУЛЬТАТ ПОСЛЕДНЕЙ попытки, поэтому клиент
// всегда может отличить свежие данные от устаревших после серии ошибок.
// Наружу сервер публикует Caddy (см. labels в docker-compose.yml).
let cache = { club: null, pcs: null, zoneOrder: [], ok: false, error: null, updatedAt: null };

async function refresh() {
    try {
        const { club, pcs, zoneOrder } = await pcStatus.getStatus();
        cache = {
            club,
            pcs,
            zoneOrder: Array.isArray(zoneOrder) ? zoneOrder : [],
            ok: true,
            error: null,
            updatedAt: Date.now(),
        };
    } catch (e) {
        console.error('Не удалось обновить статус ПК:', e.message);
        cache = { ...cache, ok: false, error: e.message };
    }
}

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.url === '/api/status') {
        res.setHeader('Content-Type', 'application/json');
        if (cache.pcs) {
            return res.end(JSON.stringify(cache));
        }
        res.statusCode = 502;
        return res.end(JSON.stringify({ ok: false, error: cache.error || 'Статус ещё не получен, попробуйте через несколько секунд', pcs: [] }));
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    fs.createReadStream(path.join(__dirname, 'index.html')).pipe(res);
});

// Слушать порт начинаем ДО первого (самого долгого) сбора статуса: сокет
// сразу встаёт в приём соединений на уровне ОС, и запросы, пришедшие пока
// идёт первый сбор данных, встают в очередь вместо отказа в соединении.
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Node под PID 1 в контейнере игнорирует SIGTERM без обработчика, и
// `docker stop` ждёт 10 секунд до SIGKILL. Закрываем сервер и выходим сразу.
function shutdown(signal) {
    console.log(`${signal}: остановка`);
    server.close(() => process.exit(0));
    server.closeAllConnections?.();
    setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

(async () => {
    try {
        await auth.ensureAuthenticated();
    } catch (e) {
        console.error('Внимание: нет активной сессии Langame —', e.message);
        console.error('Выполните: node login.js');
    }

    await refresh();
    setInterval(refresh, CACHE_TTL);
})();
