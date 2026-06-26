const http = require('http');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const PORT = 3000;
const CACHE_TTL = 15000; // 15 секунд кеша
let cache = { data: null, expires: 0 };

const MAPCLUB_URL = 'https://mapclub.langame.ru/proxy';

const server = http.createServer(async (req, res) => {
    // CORS и заголовки
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.url === '/api/status') {
        if (Date.now() < cache.expires && cache.data) {
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify(cache.data));
        }

        try {
            const headers = {
                'X-Request-token': process.env.MAPCLUB_TOKEN,
                'Content-Type': 'application/x-www-form-urlencoded',
            };
            const body = (type) => `type=${type}&domain=${process.env.MAPCLUB_DOMAIN}`;

            const [statusRes, schemaRes] = await Promise.all([
                fetch(MAPCLUB_URL, { method: 'POST', headers, body: body('pcStatus') }),
                fetch(MAPCLUB_URL, { method: 'POST', headers, body: body('clubSchema') }),
            ]);

            const [statusData, schemaData] = await Promise.all([statusRes.json(), schemaRes.json()]);

            // Логика обработки
            const numberMap = {};
            schemaData.data.forEach(item => {
                if (item.scheme_type === 'seat' && !numberMap[item.UUID]) {
                    numberMap[item.UUID] = item.text.trim();
                }
            });

            const statusMap = {};
            statusData.data.forEach(item => statusMap[item.UUID] = item.status);

            const pcs = Object.entries(numberMap).map(([uuid, number]) => ({
                uuid, number,
                free: statusMap[uuid] ?? null,
                isPs: uuid.startsWith('rele_'),
            }));

            cache = { data: { pcs, ok: true }, expires: Date.now() + CACHE_TTL };
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(cache.data));
        } catch (e) {
            res.statusCode = 502;
            res.end(JSON.stringify({ ok: false, error: e.message }));
        }
    } else {
        // Отдача статического HTML
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        fs.createReadStream(path.join(__dirname, 'index.html')).pipe(res);
    }
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));