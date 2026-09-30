// EYAD VIDEO — waveform peak extraction off the main thread.
// in:  { id, channels: [Float32Array...], sampleRate, perSec }
// out: { id, peaks: Float32Array (0..1, one value per bucket), max }
self.onmessage = (e) => {
  const { id, channels, sampleRate, perSec } = e.data;
  try {
    const len = channels[0].length;
    const bucket = Math.max(1, Math.floor(sampleRate / perSec));
    const n = Math.ceil(len / bucket);
    const peaks = new Float32Array(n);
    let max = 0;
    for (let b = 0; b < n; b++) {
      let m = 0;
      const s = b * bucket, end = Math.min(len, s + bucket);
      for (const ch of channels) {
        for (let i = s; i < end; i += 2) { const v = ch[i] < 0 ? -ch[i] : ch[i]; if (v > m) m = v; }
      }
      peaks[b] = m;
      if (m > max) max = m;
    }
    self.postMessage({ id, peaks, max }, [peaks.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
