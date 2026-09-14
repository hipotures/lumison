export const BENCHMARK_WARMUP_MS = 2000;
export const BENCHMARK_DURATION_MS = 30000;
export const BENCHMARK_BATCH_SIZE = 4;

export function benchmarkStatistics(batches, elapsedMs) {
  if (!batches.length || !Number.isFinite(elapsedMs) || !(elapsedMs > 0)) throw new Error('No completed benchmark work');
  // Completion is timed per batch, not with GPU timestamp queries. Percentiles
  // use batch duration / frames, weighted by the number of completed frames.
  const times = batches.flatMap(({ frames, durationMs }) => {
    if (!Number.isInteger(frames) || frames < 1 || !Number.isFinite(durationMs) || durationMs < 0) {
      throw new Error('Invalid completed batch');
    }
    return Array(frames).fill(durationMs / frames);
  }).sort((a, b) => a - b);
  const percentile = (p) => times[Math.max(0, Math.ceil(times.length * p) - 1)];
  return {
    frames: times.length,
    elapsedMs,
    fps: times.length * 1000 / elapsedMs,
    averageMs: batches.reduce((sum, batch) => sum + batch.durationMs, 0) / times.length,
    p50Ms: percentile(0.50),
    p95Ms: percentile(0.95),
  };
}

export function createBenchmarkResults() {
  const results = new Map();
  return {
    save(result) { results.set(result.backend, { ...result }); },
    values() { return [...results.values()].map((result) => ({ ...result })); },
  };
}

export async function runBenchmark({
  renderBatch, synchronize, signal, onProgress = () => {},
  now = () => performance.now(),
  yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 0)),
  warmupMs = BENCHMARK_WARMUP_MS, durationMs = BENCHMARK_DURATION_MS,
}) {
  const checkCancelled = () => {
    if (signal.aborted) throw new DOMException('Benchmark cancelled', 'AbortError');
  };
  const batches = [];
  checkCancelled();
  // Drain normal rendering before warm-up starts.
  await synchronize();
  for (const [phase, duration] of [['warm-up', warmupMs], ['measuring', durationMs]]) {
    const start = now();
    let lastUpdate = -Infinity;
    while (now() - start < duration) {
      checkCancelled();
      const batchStart = now();
      renderBatch(BENCHMARK_BATCH_SIZE);
      await synchronize();
      const completed = now();
      checkCancelled();
      if (phase === 'measuring') {
        batches.push({ frames: BENCHMARK_BATCH_SIZE, durationMs: completed - batchStart });
      }
      if (completed - lastUpdate >= 200) {
        onProgress({ phase, elapsedMs: completed - start, durationMs: duration });
        lastUpdate = completed;
      }
      // Include event-loop yields in throughput wall time, but not batch timing.
      if (completed - start >= duration) break;
      await yieldToBrowser();
    }
    checkCancelled();
    if (phase === 'measuring') return benchmarkStatistics(batches, now() - start);
  }
}
