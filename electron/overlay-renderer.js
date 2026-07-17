const timerEl = document.getElementById('timer');
const labelEl = document.getElementById('label');
const retryBtn = document.getElementById('retryBtn');
const cancelBtn = document.getElementById('cancelBtn');

let timerInterval = null;

const LABELS = {
  warming: 'Разогрев…',
  transcribing: 'Распознавание…',
  error: 'Произошла ошибка',
};

retryBtn.addEventListener('click', () => window.tolkovinOverlay.retry());
cancelBtn.addEventListener('click', () => window.tolkovinOverlay.cancel());

function formatElapsed(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

window.tolkovinOverlay.onState((state, startedAt) => {
  document.body.className = state;
  labelEl.textContent = LABELS[state] || '';
  clearInterval(timerInterval);

  if (state === 'recording' && startedAt) {
    const tick = () => {
      timerEl.textContent = formatElapsed(Date.now() - startedAt);
    };
    tick();
    timerInterval = setInterval(tick, 250);
  }
});
