// Pointer interaction: click/drag visibly disturbs the film and feeds the
// optional probe readout. Hover alone is non-destructive; deformation starts
// on primary-pointer down and decays smoothly after release.
import { sampleFieldApprox } from './film.js';

export function createPointer(primaryCanvas, extraTargets = []) {
  const ptr = {
    x: 0.5, y: 0.5,       // uv position
    vx: 0, vy: 0,         // smoothed velocity (uv / second)
    strength: 0,          // smoothed disturbance strength
    targetStrength: 0,
    down: false,
    active: false,        // pointer currently has a usable position
    lastT: 0,
    hoverX: 0, hoverY: 0, // viewport px for probe tip
  };

  const targets = [primaryCanvas, ...extraTargets].filter(Boolean);

  function toUV(e) {
    const target = e.currentTarget instanceof Element ? e.currentTarget : primaryCanvas;
    const r = target?.getBoundingClientRect?.() ?? { left: 0, top: 0, width: 0, height: 0 };
    const width = r.width || window.innerWidth || 1;
    const height = r.height || window.innerHeight || 1;
    const left = r.width ? r.left : 0;
    const top = r.height ? r.top : 0;
    return {
      u: (e.clientX - left) / Math.max(1, width),
      v: 1 - (e.clientY - top) / Math.max(1, height),
      cx: e.clientX,
      cy: e.clientY,
    };
  }

  function setPosition(e, resetVelocity = false) {
    const p = toUV(e);
    const now = performance.now();
    if (!resetVelocity && ptr.lastT > 0) {
      const dt = Math.max(0.004, Math.min(0.08, (now - ptr.lastT) / 1000));
      const iu = (p.u - ptr.x) / dt;
      const iv = (p.v - ptr.y) / dt;
      const cl = (v) => Math.max(-3, Math.min(3, v));
      ptr.vx += (cl(iu) - ptr.vx) * 0.42;
      ptr.vy += (cl(iv) - ptr.vy) * 0.42;
    } else if (resetVelocity) {
      ptr.vx = 0;
      ptr.vy = 0;
    }
    ptr.x = Math.max(0, Math.min(1, p.u));
    ptr.y = Math.max(0, Math.min(1, p.v));
    ptr.hoverX = p.cx;
    ptr.hoverY = p.cy;
    ptr.lastT = now;
    ptr.active = true;
  }

  const onEnter = (e) => setPosition(e, true);
  const onDown = (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    try { e.currentTarget?.setPointerCapture?.(e.pointerId); } catch { /* synthetic or stale pointer */ }
    setPosition(e, true);
    ptr.down = true;
    ptr.targetStrength = 1.55;
    // Immediate kick makes a simple click visible even before the next move.
    ptr.strength = Math.max(ptr.strength, 0.9);
  };
  const onMove = (e) => {
    setPosition(e, false);
    // Hover must not alter the artwork. Dragging deliberately does.
    ptr.targetStrength = ptr.down ? 1.55 : 0.0;
  };
  const release = (e) => {
    if (e && e.pointerId !== undefined) {
      try { e.currentTarget?.releasePointerCapture?.(e.pointerId); } catch { /* ignore */ }
    }
    ptr.down = false;
    ptr.targetStrength = 0.0;
  };
  const onLeave = () => {
    if (!ptr.down) {
      ptr.targetStrength = 0.0;
      ptr.active = false;
    }
  };

  for (const target of targets) {
    target.addEventListener('pointerenter', onEnter);
    target.addEventListener('pointerdown', onDown);
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', release);
    target.addEventListener('pointercancel', release);
    target.addEventListener('pointerleave', onLeave);
  }

  // Per-frame decay toward targets. Returns nothing; mutates ptr.
  ptr.update = (dt) => {
    const k = Math.min(1, dt * (ptr.down ? 10 : 4.5));
    ptr.strength += (ptr.targetStrength - ptr.strength) * k;
    if (!ptr.down && ptr.strength < 1e-4) ptr.strength = 0;
    const vk = Math.exp(-dt * (ptr.down ? 1.0 : 4.0));
    ptr.vx *= vk;
    ptr.vy *= vk;
    if (Math.abs(ptr.vx) < 1e-4) ptr.vx = 0;
    if (Math.abs(ptr.vy) < 1e-4) ptr.vy = 0;
  };

  return ptr;
}

// Probe readout: single-point CPU evaluation of the parametric field.
// Returns null when the pointer is outside the film.
let lastProbe = 0;
export function probeSample(ptr, params, time, minInterval = 70) {
  if (!ptr.active) return null;
  const now = performance.now();
  if (now - lastProbe < minInterval) return 'throttled';
  lastProbe = now;
  try {
    const s = sampleFieldApprox(ptr.x, ptr.y, params, time, {
      x: ptr.x, y: ptr.y, strength: ptr.strength,
    });
    return { ...s, u: ptr.x, v: ptr.y, px: ptr.hoverX, py: ptr.hoverY };
  } catch (err) {
    // A failed probe should be diagnosable instead of silently looking dead.
    console.warn('Surface probe failed:', err);
    return { error: err?.message ?? String(err), px: ptr.hoverX, py: ptr.hoverY };
  }
}
