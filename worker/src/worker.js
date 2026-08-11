// Никакого KV и пушей: воркер на каждый запрос гостя сам стучится через
// Cloudflare VPC-туннель в /api/status на клубной машине (ru-ava.local:3000).
// У неё уже есть вся нужная логика кеша/устаревания/ошибок — здесь просто
// прозрачно пробрасываем ответ.
const ORIGIN_URL = 'http://ru-ava.local:3000/api/status';

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
    return json({ ok: false, error: 'Не удалось достучаться до сервера клуба через VPC', pcs: [] }, 502);
  }

  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    },
  });
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
