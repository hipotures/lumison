import assert from 'node:assert/strict';
import test from 'node:test';
import {
  benchmarkStatistics, createBenchmarkResults, runBenchmark,
  BENCHMARK_BATCH_SIZE, BENCHMARK_DURATION_MS, BENCHMARK_WARMUP_MS,
} from '../apps/tfl-lab/src/benchmark.js';

test('benchmark statistics count completed frames and include yields in throughput only', () => {
  const result = benchmarkStatistics([
    { frames: 4, durationMs: 40 }, { frames: 4, durationMs: 80 },
  ], 160);
  assert.deepEqual(result, {
    frames: 8, elapsedMs: 160, fps: 50, averageMs: 15, p50Ms: 10, p95Ms: 20,
  });
  assert.throws(() => benchmarkStatistics([], 10));
  assert.throws(() => benchmarkStatistics([{ frames: 0, durationMs: 1 }], 10));
});

test('p50 and p95 use nearest-rank normalized completion timings weighted by frames', () => {
  const batches = Array.from({ length: 20 }, (_, i) => ({ frames: 4, durationMs: (20 - i) * 4 }));
  const result = benchmarkStatistics(batches, 1000);
  assert.equal(result.p50Ms, 10);
  assert.equal(result.p95Ms, 19);
  const weighted = benchmarkStatistics([{ frames: 19, durationMs: 19 }, { frames: 1, durationMs: 100 }], 119);
  assert.equal(weighted.p50Ms, 1);
  assert.equal(weighted.p95Ms, 1);
});

test('completed results are retained separately per backend and replaced only for that backend', () => {
  const results = createBenchmarkResults();
  const gpu = { backend: 'WebGPU', fps: 100 };
  results.save(gpu);
  results.save({ backend: 'WebGL2', fps: 80 });
  gpu.fps = 0;
  assert.equal(results.values()[0].fps, 100);
  results.save({ backend: 'WebGPU', fps: 120 });
  assert.deepEqual(results.values(), [{ backend: 'WebGPU', fps: 120 }, { backend: 'WebGL2', fps: 80 }]);
});

test('runner excludes warm-up, waits for completed work, and yields without rAF', async () => {
  assert.equal(BENCHMARK_WARMUP_MS, 2000);
  assert.equal(BENCHMARK_DURATION_MS, 30000);
  let clock = 0;
  let pending = false;
  let yields = 0;
  const progress = [];
  const result = await runBenchmark({
    signal: new AbortController().signal,
    now: () => clock, warmupMs: 20, durationMs: 30,
    renderBatch: (frames) => {
      assert.equal(frames, BENCHMARK_BATCH_SIZE);
      assert.equal(pending, false);
      pending = true;
    },
    synchronize: async () => {
      if (pending) clock += 10;
      pending = false;
    },
    yieldToBrowser: async () => { clock += 1; yields++; },
    onProgress: (value) => progress.push(value.phase),
  });
  assert.equal(result.frames, 12);
  assert.equal(result.elapsedMs, 32);
  assert.equal(result.averageMs, 2.5);
  assert.equal(yields, 3);
  assert.ok(progress.includes('warm-up'));
  assert.ok(progress.includes('measuring'));
});

test('cancellation and synchronization failures return no misleading completed result', async () => {
  const controller = new AbortController();
  let clock = 0;
  let batches = 0;
  await assert.rejects(runBenchmark({
    signal: controller.signal, now: () => clock,
    renderBatch: () => { batches++; },
    synchronize: async () => { clock += 10; },
    yieldToBrowser: async () => controller.abort(),
  }), { name: 'AbortError' });
  assert.equal(batches, 1);
  await assert.rejects(runBenchmark({
    signal: new AbortController().signal,
    renderBatch: () => assert.fail('Must establish synchronization before rendering'),
    synchronize: async () => { throw new Error('No completion hook'); },
  }), /No completion hook/);
});
