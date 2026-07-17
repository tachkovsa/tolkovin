// Persists raw audio segments to disk so a failed transcription or a failed
// paste never loses the recording — history can retry recognition later
// using the same bytes instead of asking the user to say it again.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { app } = require('electron');

function rootDir() {
  return path.join(app.getPath('userData'), 'recordings');
}

function saveSegments(segments) {
  const sessionId = crypto.randomUUID();
  const dir = path.join(rootDir(), sessionId);
  fs.mkdirSync(dir, { recursive: true });
  segments.forEach((seg, i) => {
    fs.writeFileSync(path.join(dir, `${i}.ogg`), Buffer.from(seg.buffer));
  });
  return dir;
}

function sortedSegmentFiles(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.ogg'))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
}

function loadSegments(dir) {
  return sortedSegmentFiles(dir).map((f) => fs.readFileSync(path.join(dir, f)));
}

function segmentPaths(dir) {
  return sortedSegmentFiles(dir).map((f) => path.join(dir, f));
}

function remove(dir) {
  if (!dir) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

module.exports = { saveSegments, loadSegments, segmentPaths, remove };
