const timerEl = document.getElementById('timer');

let timerInterval = null;

function formatElapsed(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

window.tolkovinOverlay.onState((state, startedAt) => {
  document.body.className = state;
  clearInterval(timerInterval);

  if (state === 'recording' && startedAt) {
    const tick = () => {
      timerEl.textContent = formatElapsed(Date.now() - startedAt);
    };
    tick();
    timerInterval = setInterval(tick, 250);
  }
});
