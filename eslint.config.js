const js = require('@eslint/js');
const globals = require('globals');
const prettier = require('eslint-config-prettier');

module.exports = [
  {
    ignores: ['node_modules/**', 'dist/**', 'electron/vendor/**', 'native/fn-watcher'],
  },
  js.configs.recommended,
  {
    // Electron main-process / Node-side files (CommonJS, require/process/Buffer available)
    files: [
      '*.config.js',
      'electron/main.js',
      'electron/config.js',
      'electron/db.js',
      'electron/log.js',
      'electron/paste.js',
      'electron/recordings.js',
      'electron/yandex-stt.js',
      'electron/*preload*.js',
      'scripts/**/*.js',
    ],
    languageOptions: {
      sourceType: 'commonjs',
      ecmaVersion: 2022,
      globals: { ...globals.node },
    },
  },
  {
    // Renderer-side files (run in a BrowserWindow, browser globals, no Node).
    // `Recorder` comes from vendor/recorder.min.js, loaded as a plain <script>.
    files: ['electron/*-renderer.js'],
    languageOptions: {
      sourceType: 'script',
      ecmaVersion: 2022,
      globals: { ...globals.browser, Recorder: 'readonly' },
    },
  },
  prettier,
];
