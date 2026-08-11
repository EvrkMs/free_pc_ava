'use strict';

const config = require('./config');
const mtls = require('./mtls');

/**
 * Авторизация в панели Langame.
 *
 * Разбор формы (GET /auth.php):
 *   <form action="auth.php" method="POST" enctype="application/x-www-form-urlencoded">
 *     login     — текстовое поле
 *     password  — пароль как есть (канал защищён TLS + mTLS)
 *     r         — hidden, base64 пути возврата ("Lw==" -> "/"), пустая строка допустима
 *     lang      — select, по умолчанию ru
 *   </form>
 *   Кнопка submit без name, в тело не попадает. CSRF-токена нет.
 *
 * Поведение сервера:
 *   GET  /auth.php  -> 200 + Set-Cookie: PHPSESSID=...
 *   POST /auth.php  -> 302 /auth.php?error=1 (неверные данные) или 302 на другой адрес (успех)
 *   GET  /          -> 302 /auth.php?r=<base64> пока сессия не авторизована
 */

function encodeReturnPath(pathname) {
  return Buffer.from(pathname, 'utf8').toString('base64');
}

function startSession() {
  const res = mtls.request({ path: '/auth.php' });
  if (res.status !== 200) {
    throw new Error(
      `Форма авторизации недоступна: HTTP ${res.status}. ` +
        (res.status === 401
          ? 'Сервер не принял клиентский сертификат (mTLS).'
          : 'Проверьте LANGAME_BASE_URL.'),
    );
  }
  return res;
}

function submitLoginForm(login, password, opts = {}) {
  const returnPath = opts.returnPath || '/';

  const form = new URLSearchParams();
  form.set('login', login);
  form.set('password', password);
  form.set('r', encodeReturnPath(returnPath));
  form.set('lang', config.lang);

  const res = mtls.request({
    path: '/auth.php',
    method: 'POST',
    body: form.toString(),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: config.baseUrl + '/auth.php',
    },
  });

  if (res.status === 302 || res.status === 303) {
    const failed = /\berror=1\b/.test(res.location || '');
    return {
      ok: !failed,
      status: res.status,
      location: res.location,
      reason: failed ? 'Неверный логин или пароль' : null,
    };
  }

  return {
    status: res.status,
    ok: false,
    location: res.location,
    reason: `Неожиданный ответ HTTP ${res.status} вместо редиректа`,
  };
}

/** Живая ли сессия: авторизованный GET / отдаёт 200, неавторизованный — 302 на auth.php. */
function isAuthenticated() {
  const res = mtls.request({ path: '/' });
  if (res.status === 302 || res.status === 303) {
    return !/auth\.php/.test(res.location || '');
  }
  return res.status === 200 && !/name="password"/.test(res.body);
}

/** Полный вход: свежая сессия -> отправка формы -> проверка. Пароль нигде не сохраняется. */
function login(userLogin, password, opts = {}) {
  startSession();

  const submitted = submitLoginForm(userLogin, password, opts);
  if (!submitted.ok) return submitted;

  if (!isAuthenticated()) {
    return {
      ok: false,
      status: submitted.status,
      location: submitted.location,
      reason: 'Сервер принял форму, но сессия не стала авторизованной',
    };
  }

  return { ...submitted, ok: true };
}

function logout() {
  mtls.clearSession();
}

/**
 * Гарантирует живую сессию: если она уже активна — ничего не делает.
 * Если нет — логинится данными из LANGAME_LOGIN/LANGAME_PASSWORD (env).
 * Бросает исключение, если сессии нет и данных для входа тоже нет.
 */
function ensureAuthenticated() {
  if (isAuthenticated()) return;

  if (!config.login || !config.password) {
    throw new Error(
      'Сессия Langame не активна, а LANGAME_LOGIN/LANGAME_PASSWORD не заданы — ' +
        'автологин невозможен.',
    );
  }

  const result = login(config.login, config.password);
  if (!result.ok) {
    throw new Error('Не удалось войти в Langame: ' + result.reason);
  }
}

module.exports = {
  login,
  logout,
  startSession,
  submitLoginForm,
  isAuthenticated,
  ensureAuthenticated,
  encodeReturnPath,
};
