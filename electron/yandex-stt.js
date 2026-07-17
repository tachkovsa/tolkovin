// Yandex SpeechKit v1 synchronous short-audio recognition.
// https://yandex.cloud/en/docs/speechkit/stt/api/request-api
const dns = require('node:dns');
const config = require('./config');

// This network has a black-holed IPv6 route to Yandex Cloud (curl -6 times
// out, curl -4 is instant). Node's fetch doesn't fall back from IPv6 to
// IPv4 fast enough, so it hangs for the full connect timeout. Preferring
// IPv4 at resolution time sidesteps that — no proxy needed, Yandex is
// directly reachable over v4.
dns.setDefaultResultOrder('ipv4first');

const ENDPOINT = 'https://stt.api.cloud.yandex.net/speech/v1/stt:recognize';

async function transcribe(oggOpusBuffer, { lang = 'ru-RU' } = {}) {
  const { yandexApiKey: apiKey, yandexFolder: folderId } = config.load();
  if (!apiKey || !folderId) {
    throw new Error('Yandex API key / folder not set — configure them in Settings');
  }

  const url = new URL(ENDPOINT);
  url.searchParams.set('lang', lang);
  url.searchParams.set('format', 'oggopus');
  url.searchParams.set('folderId', folderId);

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Api-Key ${apiKey}` },
    body: oggOpusBuffer,
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || !data || typeof data.result !== 'string') {
    throw new Error(`Yandex STT failed: HTTP ${res.status} ${JSON.stringify(data)}`);
  }
  return data.result;
}

module.exports = { transcribe };
