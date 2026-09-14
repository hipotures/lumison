export const FPS_HISTORY_CAPACITY = 120;

// Called by the existing presentation loop; no timers or background work.
export function createFpsHistory() {
  const samples = [];
  let started = null;
  let frames = 0;
  return {
    samples,
    frame(now) {
      if (!Number.isFinite(now)) return false;
      if (started === null || now < started) {
        started = now;
        frames = 0;
        return false;
      }
      frames++;
      const elapsed = now - started;
      if (elapsed < 1000) return false;
      samples.push(frames * 1000 / elapsed);
      if (samples.length > FPS_HISTORY_CAPACITY) samples.shift();
      started = now;
      frames = 0;
      return true;
    },
    suspend() {
      started = null;
      frames = 0;
    },
  };
}
