// Browser PointerEvent adapter. DOM coordinates and mouse-button policy end in
// this file; the engine receives only a canonical spatial influence.
import {
  advanceInfluenceDynamics,
  createSpatialInfluence,
  normalizedViewportToSurface,
  updateSurfaceVelocity,
} from '../../../packages/tfl-engine/src/spatial.js';

export function createPointerAdapter(primaryCanvas, extraTargets = []) {
  const influence = createSpatialInfluence({ id: 'tfl-lab-primary' });
  const adapter = {
    influence,
    aspect: 1,
    screenPosition: { x: 0, y: 0 },
    normalizedPosition: { x: 0.5, y: 0.5 },
    lastTime: 0,
  };
  const targets = [primaryCanvas, ...extraTargets].filter(Boolean);

  function toSurface(event, clamp) {
    const target = event.currentTarget instanceof Element ? event.currentTarget : primaryCanvas;
    const rectangle = target?.getBoundingClientRect?.()
      ?? { left: 0, top: 0, width: 0, height: 0 };
    const width = rectangle.width || window.innerWidth || 1;
    const height = rectangle.height || window.innerHeight || 1;
    const left = rectangle.width ? rectangle.left : 0;
    const top = rectangle.height ? rectangle.top : 0;
    const aspect = width / Math.max(1, height);
    return {
      position: normalizedViewportToSurface(
        (event.clientX - left) / Math.max(1, width),
        (event.clientY - top) / Math.max(1, height),
        aspect,
        { clamp },
      ),
      aspect,
      screen: { x: event.clientX, y: event.clientY },
      normalized: {
        x: Math.min(1, Math.max(0, (event.clientX - left) / Math.max(1, width))),
        y: Math.min(1, Math.max(0, (event.clientY - top) / Math.max(1, height))),
      },
    };
  }

  function setPosition(event, resetVelocity = false) {
    const raw = toSurface(event, false);
    const bounded = toSurface(event, true);
    const now = performance.now() / 1000;
    if (!resetVelocity && adapter.lastTime > 0) {
      influence.velocity = updateSurfaceVelocity(
        influence.velocity,
        influence.position,
        raw.position,
        now - adapter.lastTime,
        {
          // Fixed clamped UV components to ±3/s. Expressing that same policy
          // in surface units preserves its effective shader input.
          maximumComponents: { x: 3 * raw.aspect, y: 3 },
        },
      );
    } else if (resetVelocity) {
      influence.velocity.x = 0;
      influence.velocity.y = 0;
    }
    influence.position = bounded.position;
    influence.positionValid = true;
    adapter.aspect = bounded.aspect;
    adapter.screenPosition = bounded.screen;
    adapter.normalizedPosition = bounded.normalized;
    adapter.lastTime = now;
  }

  const onEnter = (event) => setPosition(event, true);
  const onDown = (event) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    try { event.currentTarget?.setPointerCapture?.(event.pointerId); } catch { /* stale/synthetic */ }
    setPosition(event, true);
    influence.engaged = true;
    influence.strength = Math.max(influence.strength, 0.9);
  };
  const onMove = (event) => {
    setPosition(event, false);
    // Hover submits position for diagnostics/probe; its target strength is zero.
  };
  const release = (event) => {
    if (event && event.pointerId !== undefined) {
      try { event.currentTarget?.releasePointerCapture?.(event.pointerId); } catch { /* ignore */ }
    }
    influence.engaged = false;
  };
  const onLeave = () => {
    if (!influence.engaged) influence.positionValid = false;
  };

  for (const target of targets) {
    target.addEventListener('pointerenter', onEnter);
    target.addEventListener('pointerdown', onDown);
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', release);
    target.addEventListener('pointercancel', release);
    target.addEventListener('pointerleave', onLeave);
  }

  adapter.advance = (dt) => {
    adapter.refreshViewport();
    advanceInfluenceDynamics(influence, dt, {
      targetStrength: influence.engaged ? 1.55 : 0,
    });
    return influence;
  };

  adapter.refreshViewport = () => {
    const rectangle = primaryCanvas?.getBoundingClientRect?.();
    const width = rectangle?.width || window.innerWidth || 1;
    const height = rectangle?.height || window.innerHeight || 1;
    const aspect = width / Math.max(1, height);
    if (Math.abs(aspect - adapter.aspect) < 1e-9) return;
    adapter.aspect = aspect;
    influence.position = normalizedViewportToSurface(
      adapter.normalizedPosition.x,
      adapter.normalizedPosition.y,
      aspect,
    );
    // A viewport basis change is not source motion.
    influence.velocity.x = 0;
    influence.velocity.y = 0;
  };

  return adapter;
}
