// Performance monitor + adaptive quality controller.
//
// Adaptive behaviour (both directions, with hysteresis):
//  - sample smoothed FPS over windows of ~2.5 s,
//  - step down only after 2 consecutive windows materially below target,
//  - step up after 3 consecutive windows at the target (VSync-safe),
//  - 5 s cooldown after any change, bounded single steps,
//  - descent path: renderScale -> quality level; ascent reverses it,
//  - never exceeds the user's manual quality / renderScale (safety bound).
import { QUALITY_LEVELS } from './state.js';

export function createPerf() {
  return {
    fps: 0,
    frameMs: 0,
    emaDt: 1 / 60,
    alpha: 0.06,
    worstMs: 0,
    frames: 0,
  };
}

export function perfTick(perf, dtMs) {
  const dt = Math.max(1e-4, dtMs / 1000);
  perf.emaDt += (dt - perf.emaDt) * perf.alpha;
  perf.fps = 1 / Math.max(1e-4, perf.emaDt);
  perf.frameMs = perf.emaDt * 1000;
  perf.frames++;
  if (dtMs > perf.worstMs) perf.worstMs = dtMs;
}

export function createAdaptive() {
  return {
    windowFps: [],
    windowStart: performance.now(),
    badWindows: 0,
    goodWindows: 0,
    cooldownUntil: 0,
    lastAction: 'none',
    // Descent ladder state, rebuilt when user changes manual settings.
    scaleSteps: [],
    stepIndex: -1, // position on the ladder; ladder[0] = best
    active: false,
  };
}

function buildLadder(manualQuality, manualScale) {
  const qi = QUALITY_LEVELS.indexOf(manualQuality);
  const ladder = [{ quality: manualQuality, scale: manualScale }];
  for (let s = manualScale - 0.15; s >= 0.5; s -= 0.15) {
    ladder.push({ quality: manualQuality, scale: round2(s) });
  }
  for (let q = qi - 1; q >= 0; q--) {
    ladder.push({ quality: QUALITY_LEVELS[q], scale: 0.7 });
    ladder.push({ quality: QUALITY_LEVELS[q], scale: 0.55 });
  }
  return ladder;
}

function round2(v) { return Math.round(v * 100) / 100; }

// Called once per frame with the instantaneous fps estimate. Returns an
// action {quality, scale} when a step should be applied, else null.
export function adaptiveTick(ad, fps, now, cfg) {
  // cfg: {enabled, targetFps, manualQuality, manualScale}
  if (!cfg.enabled) { ad.active = false; return null; }
  if (!ad.active || ad.manualKey !== cfg.manualQuality + '@' + cfg.manualScale) {
    ad.scaleSteps = buildLadder(cfg.manualQuality, cfg.manualScale);
    ad.stepIndex = 0;
    ad.manualKey = cfg.manualQuality + '@' + cfg.manualScale;
    ad.badWindows = 0; ad.goodWindows = 0;
    ad.windowStart = now;
    ad.active = true;
  }
  if (now - ad.windowStart < 2500) return null;
  ad.windowStart = now;

  // Do not require FPS above the target: with a 60 Hz VSync cap, a 60 fps
  // target can never report 66 fps. Reaching the target for several windows
  // is enough to cautiously probe one step upward. Hysteresis still keeps
  // descent easier when a higher step cannot sustain the target.
  const below = fps < cfg.targetFps - 4;
  const atTarget = fps >= cfg.targetFps - 0.75;
  ad.badWindows = below ? ad.badWindows + 1 : 0;
  ad.goodWindows = atTarget ? ad.goodWindows + 1 : 0;

  if (now < ad.cooldownUntil) return null;
  if (ad.badWindows >= 2 && ad.stepIndex < ad.scaleSteps.length - 1) {
    ad.stepIndex++;
    ad.badWindows = 0; ad.goodWindows = 0;
    ad.cooldownUntil = now + 5000;
    ad.lastAction = `down -> ${ad.scaleSteps[ad.stepIndex].quality} @${ad.scaleSteps[ad.stepIndex].scale}`;
    return { ...ad.scaleSteps[ad.stepIndex] };
  }
  if (ad.goodWindows >= 3 && ad.stepIndex > 0) {
    ad.stepIndex--;
    ad.badWindows = 0; ad.goodWindows = 0;
    ad.cooldownUntil = now + 5000;
    ad.lastAction = `up -> ${ad.scaleSteps[ad.stepIndex].quality} @${ad.scaleSteps[ad.stepIndex].scale}`;
    return { ...ad.scaleSteps[ad.stepIndex] };
  }
  return null;
}
