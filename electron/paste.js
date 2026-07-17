// Pastes text into whatever field currently has OS focus, via clipboard +
// simulated Cmd+V. Requires Accessibility permission for the host process
// (System Settings > Privacy & Security > Accessibility) so "System Events"
// is allowed to send keystrokes.
const { clipboard } = require('electron');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const log = require('./log');

const execFileAsync = promisify(execFile);

async function pasteText(text) {
  const previous = clipboard.readText();
  clipboard.writeText(text);
  log.log('[paste] wrote to clipboard, readback matches:', clipboard.readText() === text);
  try {
    const { stdout } = await execFileAsync('osascript', [
      '-e',
      'tell application "System Events" to name of first application process whose frontmost is true',
    ]);
    log.log('[paste] frontmost app at paste time:', stdout.trim());

    await execFileAsync('osascript', [
      '-e',
      'tell application "System Events" to keystroke "v" using command down',
    ]);
    log.log('[paste] keystroke command completed without error');
  } catch (err) {
    log.error('[paste] failed', String((err && err.stack) || err));
    throw err;
  } finally {
    setTimeout(() => clipboard.writeText(previous), 500);
  }
}

module.exports = { pasteText };
