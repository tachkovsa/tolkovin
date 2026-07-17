// Persisted user settings (API key / folder / mic device), stored outside
// the app bundle so they survive updates and don't require .env in
// packaged builds. .env values (dev convenience) are used as the initial
// defaults the first time the config file is created.
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

let configPath = null;
let cache = null;

function getConfigPath() {
  if (!configPath) configPath = path.join(app.getPath('userData'), 'config.json');
  return configPath;
}

function defaults() {
  return {
    yandexApiKey: process.env.YANDEX_AI_API_KEY || '',
    yandexFolder: process.env.YANDEX_AI_FOLDER || '',
    micDeviceId: '',
    pricePerMinuteRub: 0,
  };
}

function load() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf8');
    cache = { ...defaults(), ...JSON.parse(raw) };
  } catch {
    cache = defaults();
  }
  return cache;
}

function save(partial) {
  cache = { ...load(), ...partial };
  fs.writeFileSync(getConfigPath(), JSON.stringify(cache, null, 2));
  return cache;
}

module.exports = { load, save };
