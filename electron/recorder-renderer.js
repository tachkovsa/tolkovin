// Runs in a hidden BrowserWindow. Keeps the mic stream open continuously
// (getUserMedia latency was clipping the first word of every recording)
// and encodes to Ogg Opus via opus-recorder. Yandex's sync recognition
// endpoint hard-caps every request at 30s AND 1MB regardless of format, so
// a single long hold gets sliced into sub-30s segments — cut at a pause in
// speech when we can find one (via a simple RMS silence check), or forced
// at a hard ceiling if the user just doesn't stop talking. Segments are
// collected and shipped to main together once Fn is released, where
// they're transcribed in order and the text is concatenated into one paste.
//
// Each segment gets its own opus-recorder Recorder instance. opus-recorder's
// start()/stop() is designed for one recording per instance — reusing a
// single instance across a stop()+start() cut re-sends "init" to the same
// encoder worker in a way the library doesn't document or test, which
// silently produced broken/empty audio for every segment after the first.
// A fresh instance per segment sidesteps that entirely.

// Silence-detection only arms in the last few seconds before the hard cap —
// arming it right after 15s (as before) meant the very first ordinary
// mid-sentence pause triggered an immediate cut, so a 60s dictation was
// splitting into 4 segments of ~15s each instead of using the ~27s budget
// Yandex actually allows. Narrowing the window to just before the ceiling
// lets each segment run close to full length and only look for a clean
// pause to cut on right before being forced to.
const ARM_AFTER_MS = 23000; // don't look for a silence cut before this
const HARD_SEGMENT_MS = 27000; // force a cut here regardless of silence
const SILENCE_RMS = 0.02;
const SILENCE_HOLD_MS = 600; // how long the signal must stay quiet to count as a pause
const POLL_MS = 150;

let audioCtx = null;
let mediaStream = null;
let sourceNode = null;
let analyser = null;
let analyserBuffer = null;
let readyPromise = null;

let sessionActive = false;
let segments = []; // { buffer, durationMs }[]
let segmentStartedAt = 0;
let silenceStartedAt = null;
let pollTimer = null;
let currentRecorder = null;

function ensureReady() {
  if (!readyPromise) {
    readyPromise = (async () => {
      const deviceId = await window.tolkovin.getMicDeviceId();
      const audioConstraints = { channelCount: 1, echoCancellation: true, noiseSuppression: true };
      if (deviceId) audioConstraints.deviceId = { exact: deviceId };

      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      console.log('mic warmed up, tracks:', mediaStream.getAudioTracks().length);

      audioCtx = new AudioContext();
      sourceNode = audioCtx.createMediaStreamSource(mediaStream);

      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      analyserBuffer = new Float32Array(analyser.fftSize);
      sourceNode.connect(analyser); // parallel tap, doesn't touch any recorder's own graph
    })();
  }
  return readyPromise;
}

// Warm up as soon as this hidden window loads, so the very first Fn press
// already has a live mic stream instead of paying init latency.
ensureReady().catch((err) => console.error('[recorder] warmup failed', String(err)));

function currentRms() {
  analyser.getFloatTimeDomainData(analyserBuffer);
  let sum = 0;
  for (let i = 0; i < analyserBuffer.length; i++) sum += analyserBuffer[i] * analyserBuffer[i];
  return Math.sqrt(sum / analyserBuffer.length);
}

function createSegmentRecorder() {
  return new Recorder({
    sourceNode,
    encoderPath: 'vendor/encoderWorker.min.js',
    encoderSampleRate: 16000,
    encoderApplication: 2048, // OPUS_APPLICATION_VOIP — tuned for speech
    encoderBitRate: 24000,
    numberOfChannels: 1,
    streamPages: false, // one complete Ogg Opus buffer per stop()
  });
}

function startSegment() {
  segmentStartedAt = Date.now();
  const rec = createSegmentRecorder();
  currentRecorder = rec;
  let cutAt = null;

  rec.cutNow = () => {
    cutAt = Date.now();
    rec.stop();
  };

  rec.ondataavailable = (typedArray) => {
    const durationMs = (cutAt ?? Date.now()) - segmentStartedAt;
    segments.push({ buffer: typedArray.buffer, durationMs });
    console.log(
      'segment captured, bytes:',
      typedArray.byteLength,
      'durationMs:',
      durationMs,
      '| total segments:',
      segments.length
    );
    rec.close().catch((err) => console.error('[recorder] segment close failed', String(err)));

    if (sessionActive) {
      // more speech may follow this cut — start a fresh instance for the next segment
      startSegment();
    } else {
      const toSend = segments;
      segments = [];
      window.tolkovin.sendAudioSegments(toSend);
    }
  };

  return rec.start();
}

function requestSegmentCut() {
  currentRecorder?.cutNow();
}

function pollForSilence() {
  if (!sessionActive) return;
  const now = Date.now();
  const elapsed = now - segmentStartedAt;

  if (currentRms() < SILENCE_RMS) {
    if (silenceStartedAt === null) silenceStartedAt = now;
  } else {
    silenceStartedAt = null;
  }
  const silenceHeld = silenceStartedAt ? now - silenceStartedAt : 0;

  const cutOnPause = elapsed >= ARM_AFTER_MS && silenceHeld >= SILENCE_HOLD_MS;
  const cutOnHardCap = elapsed >= HARD_SEGMENT_MS;
  if (cutOnPause || cutOnHardCap) {
    console.log('cutting segment, reason:', cutOnHardCap ? 'hard-cap' : 'silence', '| elapsed:', elapsed);
    silenceStartedAt = null;
    requestSegmentCut();
  }
}

window.tolkovin.onStart(async () => {
  await ensureReady(); // no-op after the first call — stream is already live
  segments = [];
  sessionActive = true;
  silenceStartedAt = null;
  await startSegment();
  console.log('recording started');

  clearInterval(pollTimer);
  pollTimer = setInterval(pollForSilence, POLL_MS);
});

window.tolkovin.onStop(() => {
  console.log('recording stopped');
  sessionActive = false;
  clearInterval(pollTimer);
  requestSegmentCut(); // final segment — ondataavailable will see sessionActive=false and ship everything
});
