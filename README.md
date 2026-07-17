<p align="center">
  <a href="#english">🇬🇧 English</a> &nbsp;|&nbsp; <a href="#русский">🇷🇺 Русский</a>
</p>

---

<a id="english"></a>

## English

# Tolkovin

Push-to-talk dictation for macOS: hold **Fn**, speak, release — the audio is
transcribed by Yandex SpeechKit and pasted into whatever field has focus.

## Features

- **Hold-to-talk on Fn** — a global, system-wide hotkey (not just in-app);
  release to transcribe and paste automatically.
- **Long dictations** — recordings longer than Yandex's ~30s synchronous
  request limit are automatically split into segments (cut at a natural
  pause where possible) and stitched back into one paste.
- **Recording overlay** — a small floating pill shows a live equalizer
  animation and an elapsed-time counter while recording, and a spinner while
  transcribing.
- **History & retry** — every recording's audio is saved to disk, not just
  the recognized text. If recognition or the paste itself fails, nothing is
  lost: reopen it from History and retry recognition or retry pasting.
- **Dashboard** — usage stats (clips, words, minutes, estimated cost) for the
  last 7 and 30 days. Cost is logged per recording at the price-per-minute
  that was in effect _at that time_, and survives deleting history entries —
  it is not recomputed live from whatever is left in the list.
- **Menu bar only** — no Dock icon, a light, template-style tray icon that
  follows the system's light/dark menu bar.

## Architecture

- `native/fn-watcher.swift` — a tiny CLI that watches system-wide
  `flagsChanged` events via `CGEventTap` and prints `DOWN`/`UP` when the Fn
  key state changes. This is the one genuinely macOS-specific, non-Electron
  piece — Electron's own `globalShortcut` API can't do hold-to-talk (no
  keyup) and can't bind Fn at all (it's a modifier flag, not a normal key).
- `electron/main.js` — spawns the watcher, drives the state machine
  (`idle → recording → transcribing → idle`), owns the tray icon, and wires
  up the SQLite-backed history and usage ledger.
- `electron/recorder.html` + `recorder-renderer.js` — a hidden
  (`show: false`, never focused) `BrowserWindow` that does the actual mic
  capture via `getUserMedia` + `AudioContext`, downmixed to 16kHz mono Opus
  via `opus-recorder`, and ships segment buffers back to main over IPC. Each
  segment gets its own `Recorder` instance — the library's `start()`/`stop()`
  is designed for one recording per instance.
- `electron/overlay.html` + `overlay-renderer.js` — the floating
  recording/transcribing indicator.
- `electron/workspace.html` + `workspace-renderer.js` — the single app
  window (History / Dashboard / Settings, switched via a sidebar), opened
  from the tray menu.
- `electron/yandex-stt.js` — POSTs each segment to Yandex SpeechKit's
  synchronous recognition endpoint.
- `electron/paste.js` — clipboard + simulated Cmd+V via `osascript`
  (restores the previous clipboard contents shortly after).
- `electron/db.js` — `better-sqlite3`: a `transcriptions` table (history,
  deletable) and a separate append-only `usage_log` table (Dashboard stats,
  independent of what's still in history).
- `electron/recordings.js` — persists each segment's raw audio to disk so a
  failed transcription/paste can be retried later without re-recording.

## Setup

```bash
npm install          # also rebuilds better-sqlite3 for Electron's Node ABI
npm run build:watcher # compiles native/fn-watcher.swift -> native/fn-watcher
npm start
```

`.env` needs `YANDEX_AI_API_KEY` and `YANDEX_AI_FOLDER` (used as the initial
defaults the first time Settings are saved; can also be set from the app's
Settings tab afterwards).

### macOS permissions (one-time, per host process)

Three separate TCC grants are involved. In dev, the "host process" is
whatever launches `electron .` — usually your terminal app. In a packaged
build, all three attach to that `.app` bundle instead.

1. **Microphone** — prompted automatically on first recording attempt.
2. **Input Monitoring** — required for `fn-watcher` to create its event tap.
   System Settings → Privacy & Security → Input Monitoring. **Fully quit and
   relaunch the host process** after granting — macOS only applies it to
   processes started after the grant.
3. **Accessibility** — required for the `osascript`/System Events Cmd+V
   simulation in `paste.js`. Same location, same restart caveat. Note: while
   this is still pending, macOS may repeatedly terminate the Fn watcher a
   few seconds after it starts — this resolves itself once the permission is
   granted.

### Building a distributable app

```bash
npm run package:mac   # outputs dist/mac/Tolkovin.app
```

The build is not signed with a paid Apple Developer ID (`identity: null`).
Ad-hoc signing it (`codesign --force --deep --sign - dist/mac/Tolkovin.app`)
avoids a Gatekeeper "damaged app" warning, but permissions are still tied to
that specific unsigned build — expect to re-grant Input
Monitoring/Accessibility after rebuilding.

## Known rough edges

- No streaming — recognition only starts after a segment/the recording ends,
  so very long dictations wait for each synchronous SpeechKit round-trip.
- Fn is macOS-only by nature (a hardware-level modifier, not a normal key
  event on other platforms), so a Windows port would need a different
  default hotkey rather than reusing `fn-watcher`.

## License

MIT — see [LICENSE](LICENSE).

---

<a id="русский"></a>

## Русский

# Толковин

Диктовка по удержанию клавиши для macOS: зажми **Fn**, скажи, отпусти — аудио
распознаётся через Yandex SpeechKit и вставляется в то поле, где сейчас
фокус.

## Возможности

- **Удержание Fn** — глобальная системная горячая клавиша (работает в любом
  приложении); при отпускании текст распознаётся и вставляется автоматически.
- **Длинные надиктовки** — записи длиннее ~30 секунд (ограничение
  синхронного запроса Yandex) автоматически режутся на куски (по возможности
  на естественной паузе в речи) и склеиваются в один вставляемый текст.
- **Индикатор записи** — всплывающая плашка с живой анимацией эквалайзера и
  счётчиком времени во время записи, и спиннером во время распознавания.
- **История и повтор** — на диск сохраняется само аудио каждой записи, а не
  только распознанный текст. Если распознавание или сама вставка не
  удались — ничего не потеряно: можно открыть запись в Истории и повторить
  распознавание или вставку.
- **Дашборд** — статистика использования (записи, слова, минуты, оценка
  стоимости) за последние 7 и 30 дней. Стоимость фиксируется по цене за
  минуту, действовавшей _на момент записи_, и не зависит от удаления записей
  из истории — не пересчитывается на лету по тому, что осталось в списке.
- **Только в строке меню** — без иконки в Dock, светлая иконка-шаблон,
  подстраивающаяся под светлую/тёмную строку меню системы.

## Архитектура

- `native/fn-watcher.swift` — маленькая CLI-утилита, которая слушает
  системные события `flagsChanged` через `CGEventTap` и печатает `DOWN`/`UP`
  при изменении состояния клавиши Fn. Это единственная по-настоящему
  macOS-специфичная часть вне Electron — собственный `globalShortcut` в
  Electron не умеет удержание (нет keyup) и вообще не может забиндить Fn
  (это флаг-модификатор, а не обычная клавиша).
- `electron/main.js` — запускает вотчер, ведёт машину состояний
  (`idle → recording → transcribing → idle`), владеет иконкой в трее,
  историей на SQLite и журналом расходов.
- `electron/recorder.html` + `recorder-renderer.js` — скрытое
  (`show: false`, никогда не в фокусе) `BrowserWindow`, которое реально
  захватывает микрофон через `getUserMedia` + `AudioContext`, понижает до
  16кГц моно Opus через `opus-recorder` и отправляет буферы сегментов в
  main-процесс по IPC. Каждый сегмент получает свой собственный экземпляр
  `Recorder` — `start()`/`stop()` библиотеки рассчитаны на одну запись на
  экземпляр.
- `electron/overlay.html` + `overlay-renderer.js` — плавающий индикатор
  записи/распознавания.
- `electron/workspace.html` + `workspace-renderer.js` — единое окно
  приложения (История / Дашборд / Настройки, переключение через боковую
  панель), открывается из меню в трее.
- `electron/yandex-stt.js` — отправляет каждый сегмент в синхронный endpoint
  распознавания Yandex SpeechKit.
- `electron/paste.js` — буфер обмена + имитация Cmd+V через `osascript`
  (возвращает предыдущее содержимое буфера обмена вскоре после вставки).
- `electron/db.js` — `better-sqlite3`: таблица `transcriptions` (история,
  можно удалять записи) и отдельная, только-на-добавление таблица
  `usage_log` (статистика дашборда, не зависящая от того, что осталось в
  истории).
- `electron/recordings.js` — сохраняет сырое аудио каждого сегмента на диск,
  чтобы неудавшееся распознавание/вставку можно было повторить позже без
  повторной записи.

## Установка

```bash
npm install           # заодно пересобирает better-sqlite3 под Node ABI Electron
npm run build:watcher  # компилирует native/fn-watcher.swift -> native/fn-watcher
npm start
```

В `.env` нужны `YANDEX_AI_API_KEY` и `YANDEX_AI_FOLDER` (используются как
значения по умолчанию при первом сохранении Настроек; впоследствии их можно
менять прямо во вкладке Settings приложения).

### Разрешения macOS (по одному разу на процесс-хост)

Задействованы три отдельных разрешения TCC. В dev-режиме "процесс-хост" —
это то, что запускает `electron .` (обычно ваш терминал). В собранном
приложении все три разрешения привязываются к самому `.app`-бандлу.

1. **Микрофон** — запрашивается автоматически при первой попытке записи.
2. **Input Monitoring** — нужен, чтобы `fn-watcher` мог создать перехват
   событий. System Settings → Privacy & Security → Input Monitoring.
   **Полностью выйдите и перезапустите процесс-хост** после выдачи
   разрешения — macOS применяет его только к процессам, запущенным после
   выдачи.
3. **Accessibility** — нужен для имитации Cmd+V через `osascript`/System
   Events в `paste.js`. То же место, тот же нюанс с перезапуском. Обратите
   внимание: пока это разрешение не выдано, macOS может периодически
   завершать процесс `fn-watcher` через несколько секунд после запуска —
   это проходит само после выдачи разрешения.

### Сборка дистрибутива

```bash
npm run package:mac   # результат в dist/mac/Tolkovin.app
```

Сборка не подписана платным Apple Developer ID (`identity: null`). Ad-hoc
подпись (`codesign --force --deep --sign - dist/mac/Tolkovin.app`) убирает
предупреждение Gatekeeper о "повреждённом" приложении, но разрешения всё
равно привязаны к конкретной неподписанной сборке — после пересборки,
скорее всего, придётся заново дать Input Monitoring/Accessibility.

## Известные шероховатости

- Нет потокового распознавания — оно начинается только после завершения
  сегмента/записи, поэтому очень длинные надиктовки ждут каждый синхронный
  round-trip до SpeechKit.
- Fn по своей природе есть только на macOS (аппаратный флаг-модификатор, а
  не обычное событие клавиши на других платформах), поэтому порт под
  Windows потребует другой хоткей по умолчанию, а не переиспользование
  `fn-watcher`.

## Лицензия

MIT — см. [LICENSE](LICENSE).
