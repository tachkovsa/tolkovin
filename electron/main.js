require('dotenv').config();

const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  session,
  systemPreferences,
  screen,
  dialog,
  shell,
  clipboard,
} = require('electron');

const { transcribe } = require('./yandex-stt');
const { pasteText } = require('./paste');
const db = require('./db');
const recordings = require('./recordings');
const config = require('./config');
const log = require('./log');

process.on('uncaughtException', (err) => log.error('[uncaughtException]', String((err && err.stack) || err)));
process.on('unhandledRejection', (err) =>
  log.error('[unhandledRejection]', String((err && err.stack) || err))
);

const MIN_RECORDING_MS = 150; // ignore accidental taps
const OVERLAY_SIZE = { width: 300, height: 52 }; // wide enough for the error state's icon + Retry/Cancel buttons

let tray = null;
let recorderWindow = null;
let overlayWindow = null;
let workspaceWindow = null;
let watcherProc = null;
let watcherEverReady = false;
let watcherRestartCount = 0;
let quitting = false;
let state = 'idle'; // idle | warming | recording | transcribing | error
let lastRecordingId = null; // db row the overlay's error panel can retry

function createRecorderWindow() {
  recorderWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  recorderWindow.loadFile(path.join(__dirname, 'recorder.html'));
  recorderWindow.webContents.on('console-message', (_e, _level, message) => {
    log.log('[recorder-renderer]', message);
  });
}

function createOverlayWindow() {
  const display = screen.getPrimaryDisplay();
  const x = Math.round(display.workArea.x + (display.workArea.width - OVERLAY_SIZE.width) / 2);
  const y = display.workArea.y + display.workArea.height - OVERLAY_SIZE.height - 12;

  overlayWindow = new BrowserWindow({
    x,
    y,
    width: OVERLAY_SIZE.width,
    height: OVERLAY_SIZE.height,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  overlayWindow.setAlwaysOnTop(true, 'floating');
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.setIgnoreMouseEvents(true);
  overlayWindow.loadFile(path.join(__dirname, 'overlay.html'));
}

function createWorkspaceWindow() {
  if (workspaceWindow) {
    workspaceWindow.focus();
    return;
  }
  workspaceWindow = new BrowserWindow({
    width: 720,
    height: 580,
    title: 'Tolkovin',
    webPreferences: {
      preload: path.join(__dirname, 'workspace-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  workspaceWindow.loadFile(path.join(__dirname, 'workspace.html'));
  workspaceWindow.webContents.on('console-message', (_e, _level, message) => {
    log.log('[workspace-renderer]', message);
  });
  workspaceWindow.on('closed', () => {
    workspaceWindow = null;
  });
}

const STATE_LABELS = {
  idle: 'Idle — hold Fn to talk',
  warming: 'Warming up mic…',
  recording: 'Recording…',
  transcribing: 'Transcribing…',
  error: 'Recognition failed',
};

function refreshTray() {
  const menu = Menu.buildFromTemplate([
    { label: STATE_LABELS[state] || state, enabled: false },
    { type: 'separator' },
    { label: 'Open Tolkovin', click: () => createWorkspaceWindow() },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

function createTray() {
  const trayIconPath = path.join(__dirname, '..', 'assets', 'trayTemplate.png');
  const trayIcon = nativeImage.createFromPath(trayIconPath);
  trayIcon.setTemplateImage(true);
  tray = new Tray(trayIcon);
  refreshTray();
}

let recordingStartedAt = null;

function setState(next) {
  state = next;
  refreshTray();
  // The overlay is click-through (setIgnoreMouseEvents) in every state except
  // 'error', where it grows Retry/Cancel buttons the user needs to click.
  overlayWindow.setIgnoreMouseEvents(next !== 'error');
  if (next === 'idle') {
    overlayWindow.hide();
  } else {
    if (next === 'recording') recordingStartedAt = Date.now();
    overlayWindow.webContents.send('overlay-state', next, recordingStartedAt);
    overlayWindow.showInactive();
  }
}

function resolveFnWatcherPath() {
  // Don't trust app.isPackaged here — renaming the dev Electron binary (see
  // scripts/rename-electron.sh) makes Electron's own packaged-detection
  // heuristic misfire, since it keys off the executable name. Just check
  // which candidate path actually exists instead.
  const candidates = [
    process.resourcesPath && path.join(process.resourcesPath, 'fn-watcher'),
    path.join(__dirname, '..', 'native', 'fn-watcher'),
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  log.log('[resolveFnWatcherPath] candidates:', candidates, '| chosen:', found);
  if (!found) {
    throw new Error(`fn-watcher binary not found in any of: ${candidates.join(', ')}`);
  }
  return found;
}

function promptForInputMonitoring() {
  dialog
    .showMessageBox({
      type: 'warning',
      title: 'Tolkovin needs Input Monitoring access',
      message: "Tolkovin couldn't start the global Fn-key listener.",
      detail:
        'Grant Input Monitoring access to Tolkovin in System Settings, then quit and reopen Tolkovin (the permission only applies to freshly-started processes).',
      buttons: ['Open System Settings', 'Later'],
      defaultId: 0,
    })
    .then(({ response }) => {
      if (response === 0) {
        shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent');
      }
    });
}

function startWatcher() {
  const bin = resolveFnWatcherPath();
  log.log('[startWatcher] spawning', bin);
  watcherEverReady = false;
  watcherProc = spawn(bin);

  let buf = '';
  watcherProc.stdout.on('data', (chunk) => {
    buf += chunk.toString();
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      log.log('[fn-watcher] line:', line, '| state:', state);
      handleWatcherLine(line);
    }
  });
  watcherProc.stderr.on('data', (chunk) => {
    log.error('[fn-watcher] stderr', chunk.toString().trim());
  });
  watcherProc.on('error', (err) => {
    log.error('[fn-watcher] failed to start', String(err));
  });
  watcherProc.on('exit', (code, signal) => {
    log.error('[fn-watcher] exited with code', code, '| signal:', signal);
    if (quitting) return;
    if (!watcherEverReady) {
      promptForInputMonitoring();
      return;
    }
    // It was working, then died mid-session (cause unclear — no crash report,
    // no obvious signal in the system log when this was last chased down).
    // Respawning beats leaving the app silently deaf until a manual restart.
    watcherRestartCount += 1;
    if (watcherRestartCount > 5) {
      log.error('[fn-watcher] restarted too many times, giving up');
      return;
    }
    log.log('[fn-watcher] restarting, attempt', watcherRestartCount);
    setTimeout(startWatcher, 500);
  });
}

function handleWatcherLine(line) {
  if (line === 'READY') {
    watcherEverReady = true;
    watcherRestartCount = 0;
    log.log('[fn-watcher] ready');
    return;
  }
  if (line === 'DOWN' && (state === 'idle' || state === 'error')) {
    // The mic is opened fresh for every recording (see recorder-renderer.js)
    // instead of staying live for the whole app session, so macOS's mic-in-use
    // indicator isn't lit permanently. That means there's a real acquisition
    // delay here — "warming" covers it so the user waits a beat instead of
    // having the first word of their dictation clipped.
    setState('warming');
    recorderWindow.webContents.send('start-recording');
  } else if (line === 'UP' && (state === 'warming' || state === 'recording')) {
    setState('transcribing');
    recorderWindow.webContents.send('stop-recording');
  }
}

ipcMain.on('recording-armed', () => {
  // Fires once the renderer's mic stream is actually live and capturing. If
  // Fn was already released by then, state has moved on to 'transcribing'
  // and this is a no-op.
  if (state === 'warming') setState('recording');
});

ipcMain.on('recording-failed', () => {
  // The renderer never got a mic stream up (permission revoked, device
  // unplugged, grabbed by another app) — no segments were ever captured, so
  // 'audio-segments-captured' will never fire to reset state on its own.
  if (state === 'warming' || state === 'recording' || state === 'transcribing') setState('idle');
});

ipcMain.handle('get-mic-device-id', () => config.load().micDeviceId || '');

ipcMain.handle('settings:get-config', () => config.load());
ipcMain.handle('settings:save-config', (_e, partial) => config.save(partial));
ipcMain.handle('settings:get-stats', () => ({
  d7: db.usageStatsSince(7),
  d30: db.usageStatsSince(30),
}));

// Transcribes every segment, tolerating individual segment failures instead
// of aborting the whole recording — a single dropped connection used to
// throw out of the loop and silently discard everything already recognized.
async function transcribeSegments(buffers) {
  const parts = [];
  let lastError = null;
  for (const [i, audio] of buffers.entries()) {
    try {
      log.log('[transcribe] segment', i, '| bytes:', audio.length);
      const text = await transcribe(audio);
      log.log('[transcribe] segment', i, 'transcribed:', text);
      if (text?.trim()) parts.push(text.trim());
    } catch (err) {
      lastError = err;
      log.error('[transcribe] segment', i, 'failed', String((err && err.stack) || err));
    }
  }
  const fullText = parts.join(' ');
  const status = lastError ? (fullText ? 'partial' : 'transcribe_error') : 'ok';
  const error = lastError ? String((lastError && lastError.message) || lastError) : null;
  return { fullText, status, error };
}

function countWords(text) {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

ipcMain.on('audio-segments-captured', async (_event, segments) => {
  // Tracked outside the try so `finally` can decide idle vs. error even if
  // something throws partway through — the overlay must never hang, and a
  // failure that never surfaces to the user is worse than a broken paste.
  let failed = false;
  try {
    const totalDurationMs = segments.reduce((n, s) => n + s.durationMs, 0);
    log.log('[audio-segments] count:', segments.length, '| totalDurationMs:', totalDurationMs);
    if (totalDurationMs < MIN_RECORDING_MS) {
      log.log('[audio-segments] too short, ignoring');
      return;
    }

    // Save to disk before attempting recognition — a failed transcribe or a
    // failed paste (both observed to happen, e.g. missing Accessibility
    // permission or a flaky connection) must never lose the recording.
    const audioDir = recordings.saveSegments(segments);
    const buffers = segments.map((s) => Buffer.from(s.buffer));

    let { fullText, status, error } = await transcribeSegments(buffers);

    if (fullText) {
      try {
        log.log('[audio-segments] pasting…');
        await pasteText(fullText);
        log.log('[audio-segments] paste command sent');
      } catch (err) {
        log.error('[paste] failed', String((err && err.stack) || err));
        status = status === 'ok' ? 'paste_error' : status;
        const pasteErrorMsg = String((err && err.message) || err);
        error = error ? `${error}; paste: ${pasteErrorMsg}` : pasteErrorMsg;
      }
    }

    lastRecordingId = db.insert({
      text: fullText,
      durationMs: totalDurationMs,
      status,
      error,
      audioDir,
      segmentCount: segments.length,
    });
    // Logged separately from the history row above — it must survive the
    // user deleting that row, and freezes the price-per-minute in effect
    // right now instead of whatever it gets changed to later in Settings.
    db.logUsage({
      durationMs: totalDurationMs,
      wordCount: countWords(fullText),
      pricePerMinuteRub: config.load().pricePerMinuteRub || 0,
    });

    // Nothing landed anywhere the user can see it — surface the error panel
    // instead of silently going idle. A 'partial' transcript that still made
    // it into the paste target doesn't count as a failure worth interrupting for.
    failed = !fullText || status === 'paste_error';
  } catch (err) {
    log.error('[transcribe] failed', String((err && err.stack) || err), '| cause:', String(err && err.cause));
    failed = true;
  } finally {
    setState(failed ? 'error' : 'idle');
  }
});

ipcMain.on('overlay-cancel', () => {
  if (state === 'error') setState('idle');
});

ipcMain.on('overlay-retry', async () => {
  if (state !== 'error' || lastRecordingId == null) return;
  setState('transcribing');
  const row = db.getById(lastRecordingId);
  if (!row) {
    setState('idle');
    return;
  }
  let fullText = row.text;
  let status = row.status;
  let error = row.error;
  try {
    if (status === 'paste_error' && row.text) {
      // Transcription already succeeded last time — only the paste failed,
      // so there's no reason to pay for another Yandex call.
      await pasteText(row.text);
      status = 'ok';
      error = null;
    } else {
      if (!row.audio_dir) throw new Error('No stored audio for this entry');
      const buffers = recordings.loadSegments(row.audio_dir);
      const result = await transcribeSegments(buffers);
      fullText = result.fullText;
      status = result.status;
      error = result.error;
      // A retry is a real, new call to Yandex — log it as additional usage
      // rather than silently re-billing for free.
      db.logUsage({
        durationMs: row.duration_ms,
        wordCount: countWords(fullText),
        pricePerMinuteRub: config.load().pricePerMinuteRub || 0,
      });
      if (fullText && status === 'ok') {
        await pasteText(fullText);
      }
    }
  } catch (err) {
    log.error('[overlay-retry] failed', String((err && err.stack) || err));
    status = status === 'ok' ? 'paste_error' : status || 'transcribe_error';
    const msg = String((err && err.message) || err);
    error = error ? `${error}; retry: ${msg}` : msg;
  }
  db.updateResult(lastRecordingId, { text: fullText, status, error });
  setState(!fullText || status === 'paste_error' ? 'error' : 'idle');
});

ipcMain.handle('history:list', () => db.all());

ipcMain.handle('history:retry-transcribe', async (_e, id) => {
  const row = db.getById(id);
  if (!row || !row.audio_dir) throw new Error('No stored audio for this entry');
  const buffers = recordings.loadSegments(row.audio_dir);
  const { fullText, status, error } = await transcribeSegments(buffers);
  // A retry is a real, new call to Yandex for this audio — log it as
  // additional usage rather than silently re-billing for free.
  db.logUsage({
    durationMs: row.duration_ms,
    wordCount: countWords(fullText),
    pricePerMinuteRub: config.load().pricePerMinuteRub || 0,
  });
  return db.updateResult(id, { text: fullText, status, error });
});

ipcMain.handle('history:retry-paste', async (_e, id) => {
  const row = db.getById(id);
  if (!row || !row.text) throw new Error('No text to paste');
  try {
    await pasteText(row.text);
    return db.updateResult(id, { text: row.text, status: 'ok', error: null });
  } catch (err) {
    const message = String((err && err.message) || err);
    db.updateResult(id, { text: row.text, status: 'paste_error', error: message });
    throw err;
  }
});

ipcMain.handle('history:copy', (_e, text) => {
  clipboard.writeText(text || '');
});

ipcMain.handle('history:get-audio-srcs', (_e, id) => {
  const row = db.getById(id);
  if (!row || !row.audio_dir) throw new Error('No stored audio for this entry');
  return recordings.segmentPaths(row.audio_dir).map((p) => pathToFileURL(p).toString());
});

ipcMain.handle('history:delete', (_e, id) => {
  const row = db.getById(id);
  if (row?.audio_dir) recordings.remove(row.audio_dir);
  db.deleteById(id);
});

app.on('window-all-closed', (e) => e.preventDefault());
app.on('before-quit', () => {
  quitting = true;
  watcherProc?.kill();
});

app.whenReady().then(async () => {
  log.log(
    '[startup] isPackaged:',
    app.isPackaged,
    '| resourcesPath:',
    process.resourcesPath,
    '| __dirname:',
    __dirname
  );

  if (process.platform === 'darwin') app.dock?.hide();

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media');
  });

  // Start the tray/watcher immediately — don't gate them on the mic dialog
  // being answered. Previously this whole sequence awaited
  // askForMediaAccess() first, so if that system dialog went unnoticed or
  // unanswered, the tray icon never appeared and Fn never got wired up at
  // all — indistinguishable from "stopped working" to the user.
  createRecorderWindow();
  createOverlayWindow();
  createTray();
  startWatcher();

  if (process.platform === 'darwin') {
    const micStatus = systemPreferences.getMediaAccessStatus('microphone');
    log.log('[startup] mic access status:', micStatus);
    systemPreferences.askForMediaAccess('microphone').then((granted) => {
      log.log('[startup] mic access granted:', granted);
    });

    // Triggers the native "Tolkovin would like to control this computer"
    // prompt up front (no keystroke sent) instead of it interrupting the
    // very first paste — that first interruption used to eat whatever had
    // just been recognized since the keystroke silently failed mid-flow.
    const accessibilityTrusted = systemPreferences.isTrustedAccessibilityClient(true);
    log.log('[startup] accessibility trusted:', accessibilityTrusted);
  }
});
