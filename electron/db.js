const path = require('node:path');
const Database = require('better-sqlite3');
const { app } = require('electron');

const db = new Database(path.join(app.getPath('userData'), 'tolkovin.db'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS transcriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ok',
    error TEXT,
    audio_dir TEXT,
    segment_count INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
// Append-only usage ledger, deliberately separate from `transcriptions`.
// Deleting a history entry (or changing the price-per-minute setting later)
// must never change what the Dashboard reports was already spent — each row
// freezes the price that was in effect at the time it was logged.
db.exec(`
  CREATE TABLE IF NOT EXISTS usage_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    word_count INTEGER NOT NULL DEFAULT 0,
    price_per_minute_rub REAL NOT NULL DEFAULT 0,
    cost_rub REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
// Migrations for dbs created before a given column existed. Each ALTER is a
// no-op error (column already exists) on a fresh or already-migrated table.
for (const ddl of [
  'ALTER TABLE transcriptions ADD COLUMN duration_ms INTEGER NOT NULL DEFAULT 0',
  "ALTER TABLE transcriptions ADD COLUMN status TEXT NOT NULL DEFAULT 'ok'",
  'ALTER TABLE transcriptions ADD COLUMN error TEXT',
  'ALTER TABLE transcriptions ADD COLUMN audio_dir TEXT',
  'ALTER TABLE transcriptions ADD COLUMN segment_count INTEGER NOT NULL DEFAULT 1',
]) {
  try {
    db.exec(ddl);
  } catch {
    // already has the column
  }
}

const insertStmt = db.prepare(`
  INSERT INTO transcriptions (text, duration_ms, status, error, audio_dir, segment_count)
  VALUES (@text, @durationMs, @status, @error, @audioDir, @segmentCount)
`);
const allStmt = db.prepare('SELECT * FROM transcriptions ORDER BY id DESC LIMIT ?');
const getStmt = db.prepare('SELECT * FROM transcriptions WHERE id = ?');
const updateResultStmt = db.prepare(
  'UPDATE transcriptions SET text = @text, status = @status, error = @error WHERE id = @id'
);
const deleteStmt = db.prepare('DELETE FROM transcriptions WHERE id = ?');

const logUsageStmt = db.prepare(`
  INSERT INTO usage_log (duration_ms, word_count, price_per_minute_rub, cost_rub)
  VALUES (@durationMs, @wordCount, @pricePerMinuteRub, @costRub)
`);
const usageSinceStmt = db.prepare(`
  SELECT COUNT(*) AS count,
         COALESCE(SUM(duration_ms), 0) AS totalDurationMs,
         COALESCE(SUM(word_count), 0) AS totalWords,
         COALESCE(SUM(cost_rub), 0) AS totalCostRub
  FROM usage_log
  WHERE created_at >= datetime('now', ?)
`);

function insert({ text, durationMs = 0, status = 'ok', error = null, audioDir = null, segmentCount = 1 }) {
  const info = insertStmt.run({ text, durationMs, status, error, audioDir, segmentCount });
  return info.lastInsertRowid;
}

function all(limit = 500) {
  return allStmt.all(limit);
}

function getById(id) {
  return getStmt.get(id);
}

function updateResult(id, { text, status, error = null }) {
  updateResultStmt.run({ id, text, status, error });
  return getStmt.get(id);
}

function deleteById(id) {
  deleteStmt.run(id);
}

function logUsage({ durationMs, wordCount = 0, pricePerMinuteRub = 0 }) {
  const costRub = (durationMs / 60000) * pricePerMinuteRub;
  logUsageStmt.run({ durationMs, wordCount, pricePerMinuteRub, costRub });
}

function usageStatsSince(days) {
  return usageSinceStmt.get(`-${days} days`);
}

module.exports = { insert, all, getById, updateResult, deleteById, logUsage, usageStatsSince };
