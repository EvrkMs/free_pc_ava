// Воркер сам раздаёт виджет (статика из public/) и прозрачно проксирует
// /api/status на реальный сервер клуба через Cloudflare VPC-туннель.
// Сертификат и сессия остаются на той машине — здесь только транзит одного
// запроса. Hostname/порт здесь должны точно совпадать с тем, что настроено
// в VPC Service в дашборде ("wrangler vpc service get <id>").
const ORIGIN_URL = 'http://127.0.0.1:3000/api/status';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    },
  });
}

async function handleStatus(env) {
  let res;
  try {
    res = await env.ORIGIN.fetch(ORIGIN_URL);
  } catch (e) {
    console.error('VPC fetch failed:', e && e.stack ? e.stack : e);
    return json({ ok: false, error: 'Не удалось достучаться до сервера клуба через VPC: ' + (e && e.message), pcs: [] }, 502);
  }

  const headers = new Headers(res.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Cache-Control', 'no-store');
  return new Response(res.body, { status: res.status, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/status' && request.method === 'GET') {
      return handleStatus(env);
    }

    return env.ASSETS.fetch(request);
  },
};
