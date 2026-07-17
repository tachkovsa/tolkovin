// console.log/error only go anywhere when launched from a terminal (dev
// mode). The packaged app is launched from Finder with no attached
// console, so nothing was visible for debugging it. This mirrors every
// call to a file instead.
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

let stream = null;

function getStream() {
  if (!stream) {
    const file = path.join(app.getPath('userData'), 'tolkovin.log');
    stream = fs.createWriteStream(file, { flags: 'a' });
  }
  return stream;
}

function write(level, args) {
  const line = `[${new Date().toISOString()}] [${level}] ${args
    .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ')}\n`;
  try {
    getStream().write(line);
  } catch {
    // ignore logging failures
  }
  (level === 'ERROR' ? console.error : console.log)(...args);
}

module.exports = {
  log: (...args) => write('INFO', args),
  error: (...args) => write('ERROR', args),
};
