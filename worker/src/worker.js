// Воркер сам раздаёт виджет (статика из public/) и прозрачно проксирует
// /api/status на реальный сервер клуба (ru-ava.local:3000) через Cloudflare
// VPC-туннель. Сертификат и сессия остаются на той машине — здесь только
// транзит одного запроса.
const ORIGIN_URL = 'http://ru-ava.local:3000/api/status';

async function handleStatus(env) {
  let res;
  try {
    res = await env.ORIGIN.fetch(ORIGIN_URL);
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Не удалось достучаться до сервера клуба через VPC', pcs: [] }),
      {
        status: 502,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
      },
    );
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
