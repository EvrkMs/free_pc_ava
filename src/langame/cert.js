'use strict';

const { spawnSync } = require('node:child_process');
const config = require('./config');

/**
 * Поиск клиентского сертификата Langame в хранилище текущего пользователя.
 *
 * Приватный ключ не читается и не может быть прочитан — он помечен
 * non-exportable и остаётся внутри CNG. curl обращается к нему по ссылке
 * через Schannel, поэтому здесь только метаданные (отпечаток, subject, срок).
 */
function listCandidates() {
  const ps = [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;',
    'Get-ChildItem Cert:\\CurrentUser\\My',
    '| Where-Object { $_.HasPrivateKey -and $_.Issuer -like "*' + config.certIssuerMatch + '*" }',
    '| Select-Object Thumbprint,Subject,Issuer,@{n="NotAfter";e={$_.NotAfter.ToString("o")}}',
    '| ConvertTo-Json -Compress -Depth 3',
  ].join(' ');

  const res = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', ps],
    { encoding: 'utf8', windowsHide: true },
  );

  if (res.status !== 0) {
    throw new Error('Не удалось прочитать хранилище сертификатов:\n' + (res.stderr || '').trim());
  }

  const out = (res.stdout || '').trim();
  if (!out) return [];

  let parsed;
  try {
    parsed = JSON.parse(out);
  } catch {
    throw new Error('Не удалось разобрать ответ PowerShell:\n' + out);
  }
  return Array.isArray(parsed) ? parsed : [parsed];
}

/**
 * Ссылка на сертификат в формате, который понимает curl со Schannel.
 * Если LANGAME_CERT_REF задан явно — используем его без поиска.
 */
function resolveCertRef() {
  if (config.certRef) return config.certRef;

  const candidates = listCandidates().filter((c) => new Date(c.NotAfter) > new Date());

  if (candidates.length === 0) {
    throw new Error(
      'Клиентский сертификат Langame не найден в Cert:\\CurrentUser\\My.\n' +
        'Проверьте, что сертификат установлен для текущего пользователя, не истёк\n' +
        'и что у него есть приватный ключ. Либо задайте отпечаток вручную:\n' +
        '  set LANGAME_CERT_REF=CurrentUser\\MY\\<отпечаток>',
    );
  }

  candidates.sort((a, b) => new Date(b.NotAfter) - new Date(a.NotAfter));
  return 'CurrentUser\\MY\\' + candidates[0].Thumbprint;
}

module.exports = { listCandidates, resolveCertRef };
