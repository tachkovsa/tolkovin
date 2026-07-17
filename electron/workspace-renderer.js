// Tab navigation
const navButtons = document.querySelectorAll('#sidebar button');
const sections = document.querySelectorAll('#content section');

function showSection(name) {
  for (const btn of navButtons) btn.classList.toggle('active', btn.dataset.section === name);
  for (const sec of sections) sec.classList.toggle('active', sec.id === `section-${name}`);
}

for (const btn of navButtons) {
  btn.addEventListener('click', () => showSection(btn.dataset.section));
}

// --- Settings ---
const apiKeyInput = document.getElementById('apiKey');
const folderInput = document.getElementById('folder');
const micSelect = document.getElementById('mic');
const priceInput = document.getElementById('price');
const settingsStatusEl = document.getElementById('settingsStatus');

async function loadMics(selectedId) {
  const devices = await navigator.mediaDevices.enumerateDevices();
  micSelect.replaceChildren();
  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = 'System default';
  micSelect.appendChild(defaultOpt);
  for (const d of devices.filter((d) => d.kind === 'audioinput')) {
    const opt = document.createElement('option');
    opt.value = d.deviceId;
    opt.textContent = d.label || `Microphone (${d.deviceId.slice(0, 6)})`;
    micSelect.appendChild(opt);
  }
  micSelect.value = selectedId || '';
}

async function initSettings() {
  // Trigger a permission-gated getUserMedia so device labels are populated.
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
  } catch {
    // ignore — device list will just show generic labels
  }

  const cfg = await window.tolkovinApp.settings.getConfig();
  apiKeyInput.value = cfg.yandexApiKey || '';
  folderInput.value = cfg.yandexFolder || '';
  priceInput.value = cfg.pricePerMinuteRub || '';
  await loadMics(cfg.micDeviceId);
}

document.getElementById('save').addEventListener('click', async () => {
  await window.tolkovinApp.settings.saveConfig({
    yandexApiKey: apiKeyInput.value.trim(),
    yandexFolder: folderInput.value.trim(),
    micDeviceId: micSelect.value,
    pricePerMinuteRub: Number(priceInput.value) || 0,
  });
  settingsStatusEl.textContent = 'Saved. Restart to apply mic changes.';
  setTimeout(() => (settingsStatusEl.textContent = ''), 3000);
  loadStats();
});

// --- Dashboard ---
function formatMinutes(ms) {
  return (ms / 60000).toFixed(1);
}

function renderStatCard(el, label, s) {
  const minutes = formatMinutes(s.totalDurationMs);
  // totalCostRub is a sum of amounts already frozen per-recording at the
  // price that was in effect when each one happened — never recomputed from
  // the current Settings price, and never affected by deleting History rows.
  const cost = s.totalCostRub > 0 ? `~${s.totalCostRub.toFixed(2)} RUB` : null;
  el.replaceChildren();
  const period = Object.assign(document.createElement('div'), { className: 'period', textContent: label });
  const numbers = Object.assign(document.createElement('div'), {
    className: 'numbers',
    textContent: `${s.count} clips`,
  });
  const detail = Object.assign(document.createElement('div'), {
    className: 'detail',
    textContent: `${s.totalWords} words · ${minutes} min${cost ? ` · ${cost}` : ''}`,
  });
  el.append(period, numbers, detail);
}

async function loadStats() {
  const { d7, d30 } = await window.tolkovinApp.settings.getStats();
  renderStatCard(document.getElementById('stat7'), 'Last 7 days', d7);
  renderStatCard(document.getElementById('stat30'), 'Last 30 days', d30);
}

// --- History ---
const historyListEl = document.getElementById('historyList');
const historyEmptyEl = document.getElementById('historyEmpty');

const BADGE_LABELS = {
  ok: 'OK',
  partial: 'Partial',
  transcribe_error: 'Recognition failed',
  paste_error: 'Paste failed',
};

function formatDate(iso) {
  return new Date(`${iso.replace(' ', 'T')}Z`).toLocaleString();
}

function formatDuration(ms) {
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function actionButton(label, onClick, extraClass = '') {
  const btn = document.createElement('button');
  btn.textContent = label;
  if (extraClass) btn.className = extraClass;
  btn.addEventListener('click', onClick);
  return btn;
}

// A recording may be several segment files (long dictations get cut into
// sub-30s pieces for Yandex). Plays them back-to-back as one continuous
// clip instead of surfacing the segment boundaries to the user.
function buildAudioPlayer(srcs) {
  const audio = document.createElement('audio');
  audio.controls = true;
  audio.style.width = '100%';
  audio.style.marginTop = '4px';
  let i = 0;
  audio.src = srcs[0];
  audio.addEventListener('ended', () => {
    i += 1;
    if (i < srcs.length) {
      audio.src = srcs[i];
      audio.play();
    } else {
      i = 0;
      audio.src = srcs[0];
    }
  });
  audio.play();
  return audio;
}

function renderHistoryItem(row) {
  const item = document.createElement('div');
  item.className = 'item';

  const top = document.createElement('div');
  top.className = 'top';
  const meta = document.createElement('span');
  meta.textContent = `${formatDate(row.created_at)} · ${formatDuration(row.duration_ms)}${row.segment_count > 1 ? ` · ${row.segment_count} segments` : ''}`;
  const badge = document.createElement('span');
  badge.className = `badge ${row.status}`;
  badge.textContent = BADGE_LABELS[row.status] || row.status;
  top.append(meta, badge);
  item.appendChild(top);

  const text = document.createElement('div');
  text.className = `text${row.text ? '' : ' empty'}`;
  text.textContent = row.text || '(no text)';
  item.appendChild(text);

  if (row.error) {
    const err = document.createElement('div');
    err.className = 'error';
    err.textContent = row.error;
    item.appendChild(err);
  }

  const actions = document.createElement('div');
  actions.className = 'actions';

  if (row.text) {
    actions.appendChild(
      actionButton('Copy', async () => {
        await window.tolkovinApp.history.copy(row.text);
      })
    );
  }

  if (row.audio_dir) {
    actions.appendChild(
      actionButton('Play', async (e) => {
        e.target.disabled = true;
        e.target.textContent = 'Loading…';
        try {
          const srcs = await window.tolkovinApp.history.getAudioSrcs(row.id);
          e.target.replaceWith(buildAudioPlayer(srcs));
        } catch (err) {
          alert(`Could not load audio: ${err.message || err}`);
          e.target.disabled = false;
          e.target.textContent = 'Play';
        }
      })
    );
  }

  if ((row.status === 'transcribe_error' || row.status === 'partial') && row.audio_dir) {
    actions.appendChild(
      actionButton(
        'Retry recognition',
        async (e) => {
          e.target.disabled = true;
          e.target.textContent = 'Retrying…';
          try {
            await window.tolkovinApp.history.retryTranscribe(row.id);
            await loadHistory();
          } catch (err) {
            alert(`Retry failed: ${err.message || err}`);
            e.target.disabled = false;
            e.target.textContent = 'Retry recognition';
          }
        },
        'primary'
      )
    );
  }

  if (row.status === 'paste_error' && row.text) {
    actions.appendChild(
      actionButton(
        'Retry paste',
        async (e) => {
          e.target.disabled = true;
          e.target.textContent = 'Pasting…';
          try {
            await window.tolkovinApp.history.retryPaste(row.id);
            await loadHistory();
          } catch (err) {
            alert(`Paste failed: ${err.message || err}`);
            e.target.disabled = false;
            e.target.textContent = 'Retry paste';
          }
        },
        'primary'
      )
    );
  }

  actions.appendChild(
    actionButton(
      'Delete',
      async () => {
        await window.tolkovinApp.history.delete(row.id);
        await loadHistory();
      },
      'danger'
    )
  );

  item.appendChild(actions);
  return item;
}

async function loadHistory() {
  const rows = await window.tolkovinApp.history.list();
  historyListEl.replaceChildren();
  historyEmptyEl.style.display = rows.length ? 'none' : '';
  for (const row of rows) historyListEl.appendChild(renderHistoryItem(row));
}

document.getElementById('historyRefresh').addEventListener('click', loadHistory);

initSettings().then(loadStats);
loadHistory();
