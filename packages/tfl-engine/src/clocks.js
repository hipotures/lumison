export const CLOCK_NAMES = Object.freeze(['animation', 'flow', 'lighting', 'events']);

export function createClocks(initial = {}) {
  const clocks = {};
  for (const name of CLOCK_NAMES) {
    const value = initial[name];
    clocks[name] = typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
  }
  return clocks;
}

// Fixed compatibility still renders from animation time and multiplies that
// time by flow/light rates in the existing shader. The separate integrated
// clocks make canonical timing observable and replayable without changing the
// Phase 1 material graph.
export function advanceClocks(clocks, dt, parameters, { paused = false } = {}) {
  if (paused || !(typeof dt === 'number' && Number.isFinite(dt)) || dt <= 0) return clocks;
  const temporal = finiteNonnegative(parameters?.temporal, 1);
  const animationDelta = dt * temporal;
  clocks.animation += animationDelta;
  clocks.flow += animationDelta * finiteNonnegative(parameters?.flowSpeed, 0);
  clocks.lighting += animationDelta * finiteNonnegative(parameters?.lightMotion, 0);
  clocks.events += dt;
  return clocks;
}

function finiteNonnegative(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : fallback;
}
