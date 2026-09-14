// Headless unit checks for the dependency-free modules (state, presets,
// perf). Run: node test/unit.mjs
import assert from 'node:assert/strict';
import {
  createState, snapshot, applySnapshot, clampParam, defaultParams,
  smoothState, PARAM_DEFS,
} from '../js/state.js';
import { applyPreset, mutate, randomize, PRESET_NAMES } from '../js/presets.js';
import { createAdaptive, adaptiveTick } from '../js/perf.js';

// --- schema sanity ---
assert.ok(PRESET_NAMES.length >= 6, 'at least six presets');
for (const [k, d] of Object.entries(PARAM_DEFS)) {
  assert.equal(d.length, 6, `def shape ${k}`);
  const [min, max, step, dflt] = d;
  assert.ok(min < max && dflt >= min && dflt <= max, `range ${k}`);
}

// --- snapshots: malformed input must never corrupt state ---
{
  const s = createState();
  const before = JSON.stringify(s.target);
  assert.equal(applySnapshot(s, null), false);
  assert.equal(applySnapshot(s, { version: 999, params: {} }), false);
  assert.equal(applySnapshot(s, { version: 1, params: { flowSpeed: 1e9, filmBase: -5, bogus: 3 } }), true);
  assert.ok(s.target.flowSpeed <= PARAM_DEFS.flowSpeed[1], 'clamped to max');
  assert.ok(s.target.filmBase >= PARAM_DEFS.filmBase[0], 'clamped to min');
  assert.equal(JSON.stringify(snapshot(s).params).includes('bogus'), false);
  void before;
}
{
  const s = createState();
  s.target.flowSpeed = 2;
  const snap = snapshot(s);
  const s2 = createState();
  assert.equal(applySnapshot(s2, JSON.parse(JSON.stringify(snap))), true);
  assert.equal(s2.target.flowSpeed, 2);
  s.locks.flowSpeed = true;
  const lockedSnap = snapshot(s);
  const s3 = createState();
  assert.equal(applySnapshot(s3, lockedSnap), true);
  assert.equal(s3.locks.flowSpeed, true, 'locks persist in snapshots');
}

// --- presets alter coherent groups, mutate stays in bounds ---
{
  const s = createState();
  for (const name of PRESET_NAMES) {
    assert.equal(applyPreset(s, name), true);
    for (const [k, v] of Object.entries(s.target)) {
      const d = PARAM_DEFS[k];
      assert.ok(v >= d[0] && v <= d[1], `${name}.${k} in range`);
    }
  }
  const a = { ...s.target };
  mutate(s);
  let changed = 0;
  for (const k of Object.keys(a)) {
    if (a[k] !== s.target[k]) changed++;
    const d = PARAM_DEFS[k];
    assert.ok(s.target[k] >= d[0] && s.target[k] <= d[1], `mutate ${k} in range`);
  }
  assert.ok(changed >= 4, `mutate changed ${changed} params`);
  randomize(s);
  for (const [k, v] of Object.entries(s.target)) {
    const d = PARAM_DEFS[k];
    assert.ok(v >= d[0] && v <= d[1], `randomize ${k} in range`);
  }
}

// --- locks survive presets/mutate/randomize/reset-style operations ---
{
  const s = createState();
  s.target.exposure = 1.17;
  s.locks.exposure = true;
  applyPreset(s, 'Deep Violet');
  assert.equal(s.target.exposure, 1.17, 'preset respects lock');
  mutate(s, () => 0.9);
  assert.equal(s.target.exposure, 1.17, 'mutate respects lock');
  randomize(s, () => 0.01);
  assert.equal(s.target.exposure, 1.17, 'randomize respects lock');
  assert.ok(s.target.ambient >= 0.24, 'randomize uses a fresh non-black lighting range');
}

// --- smoothing converges ---
{
  const s = createState();
  s.target.flowSpeed = 2.0;
  for (let i = 0; i < 600; i++) smoothState(s, 1 / 60);
  assert.ok(Math.abs(s.current.flowSpeed - 2.0) < 1e-3, 'smoothing converges');
}

// --- adaptive: down on sustained low fps, up on headroom, cooldowns ---
{
  const ad = createAdaptive();
  const cfg = { enabled: true, targetFps: 60, manualQuality: 'High', manualScale: 1.0 };
  let t = 1000;
  let action = null;
  // 3 bad windows -> exactly one step down (2 to trigger + cooldown absorbs 3rd)
  for (let w = 0; w < 3; w++) { t += 2600; action = adaptiveTick(ad, 20, t, cfg); }
  assert.ok(action && action.scale < 1.0, `steps down first via scale, got ${JSON.stringify(action)}`);
  const idxAfterDown = ad.stepIndex;
  // immediate further windows within cooldown -> no action
  t += 2600; assert.equal(adaptiveTick(ad, 20, t, cfg), null);
  // many bad windows -> keeps descending, never below ladder end
  for (let w = 0; w < 40; w++) { t += 6000; adaptiveTick(ad, 20, t, cfg); }
  assert.ok(ad.stepIndex >= idxAfterDown, 'monotonic descent under sustained load');
  assert.ok(ad.stepIndex <= ad.scaleSteps.length - 1, 'bounded descent');
  // Sustaining the target itself must be enough to climb. A 60 Hz VSync
  // display cannot report the old >66 fps threshold.
  for (let w = 0; w < 40; w++) { t += 6000; adaptiveTick(ad, 60, t, cfg); }
  assert.equal(ad.stepIndex, 0, 'climbs back to manual settings at VSync-capped target fps');
  // disabled -> null
  assert.equal(adaptiveTick(ad, 5, t + 6000, { ...cfg, enabled: false }), null);
}

console.log('unit: all checks passed');
