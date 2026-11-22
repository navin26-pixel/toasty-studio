// Detects when the LOCAL microphone is carrying speech. Each browser reports only its own mic,
// so "who spoke" is exact: nobody guesses from mixed audio. Tune the numbers below if your mic is quiet or noisy.
export function watchSpeaking(stream: MediaStream, onChange: (active: boolean) => void): () => void {
  const START = 0.02;   // level that counts as speech
  const STOP = 0.012;   // level that counts as silence (lower than START, so it does not flicker)
  const START_MS = 150; // speech must last this long to count
  const STOP_MS = 700;  // silence must last this long to end a turn

  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(analyser);
  ctx.resume().catch(() => {});
  const buf = new Float32Array(analyser.fftSize);
  let active = false;
  let since = performance.now();

  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    const rms = Math.sqrt(sum / buf.length);
    const now = performance.now();
    const loud = active ? rms > STOP : rms > START;
    if (loud === active) { since = now; return; } // nothing pending
    if (now - since >= (active ? STOP_MS : START_MS)) {
      active = loud;
      since = now;
      onChange(active);
    }
  }, 50);

  return () => { clearInterval(timer); ctx.close(); };
}