// Source-neutral spatial contracts. Browser adapters normalize their own
// coordinates before calling these helpers; this module has no DOM concepts.

export const SURFACE_SPACE = Object.freeze({
  origin: 'center',
  xAxis: 'right',
  yAxis: 'up',
  verticalExtent: 1,
  unit: 'viewport-height',
  velocityUnit: 'viewport-height-per-second',
  radiusUnit: 'viewport-height',
});

export const FIXED_INFLUENCE_RADIUS = 0.16;

const finite = (value, fallback = 0) => (
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
);

export function normalizeAspect(aspect) {
  return typeof aspect === 'number' && Number.isFinite(aspect) && aspect > 0
    ? aspect
    : 1;
}

export function normalizedViewportToSurface(xRight, yDown, aspect = 1, { clamp = true } = {}) {
  const a = normalizeAspect(aspect);
  let nx = finite(xRight, 0.5);
  let ny = finite(yDown, 0.5);
  if (clamp) {
    nx = Math.min(1, Math.max(0, nx));
    ny = Math.min(1, Math.max(0, ny));
  }
  return {
    x: (nx - 0.5) * a,
    y: 0.5 - ny,
  };
}

export function surfaceToNormalizedViewport(position, aspect = 1, { clamp = true } = {}) {
  const a = normalizeAspect(aspect);
  let x = finite(position?.x) / a + 0.5;
  let y = 0.5 - finite(position?.y);
  if (clamp) {
    x = Math.min(1, Math.max(0, x));
    y = Math.min(1, Math.max(0, y));
  }
  return { x, y };
}

export function createSpatialInfluence(overrides = {}) {
  return sanitizeSpatialInfluence({
    id: 'primary',
    position: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    radius: FIXED_INFLUENCE_RADIUS,
    strength: 0,
    engaged: false,
    positionValid: false,
    ...overrides,
  }).value;
}

export function sanitizeSpatialInfluence(candidate) {
  if (!candidate || typeof candidate !== 'object') {
    return { ok: false, reason: 'influence-must-be-an-object' };
  }
  const fields = [
    candidate.position?.x,
    candidate.position?.y,
    candidate.velocity?.x,
    candidate.velocity?.y,
    candidate.radius,
    candidate.strength,
  ];
  if (fields.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
    return { ok: false, reason: 'influence-values-must-be-finite' };
  }
  if (candidate.radius < 0 || candidate.strength < 0) {
    return { ok: false, reason: 'influence-radius-and-strength-must-be-nonnegative' };
  }
  return {
    ok: true,
    value: {
      id: typeof candidate.id === 'string' && candidate.id ? candidate.id : 'primary',
      position: { x: candidate.position.x, y: candidate.position.y },
      velocity: { x: candidate.velocity.x, y: candidate.velocity.y },
      radius: candidate.radius,
      strength: candidate.strength,
      engaged: candidate.engaged === true,
      positionValid: candidate.positionValid === true,
    },
  };
}

// Time-based velocity update in canonical surface units per second. The
// exponential response is stable when the same motion arrives at different
// event frequencies. Component bounds are optional so a compatibility adapter
// can reproduce a historical clamp without changing the canonical unit.
export function updateSurfaceVelocity(previousVelocity, from, to, dt, {
  responseRate = 32.68363052650032, // 0.42 response at 60 Hz
  minimumDt = 0.004,
  maximumDt = 0.08,
  maximumSpeed = Infinity,
  maximumComponents = null,
} = {}) {
  const prior = {
    x: finite(previousVelocity?.x),
    y: finite(previousVelocity?.y),
  };
  if (!(typeof dt === 'number' && Number.isFinite(dt)) || dt <= 0) return prior;
  const safeDt = Math.min(Math.max(dt, minimumDt), maximumDt);
  let x = (finite(to?.x) - finite(from?.x)) / safeDt;
  let y = (finite(to?.y) - finite(from?.y)) / safeDt;

  if (maximumComponents) {
    const maxX = Math.max(0, finite(maximumComponents.x, Infinity));
    const maxY = Math.max(0, finite(maximumComponents.y, Infinity));
    x = Math.min(maxX, Math.max(-maxX, x));
    y = Math.min(maxY, Math.max(-maxY, y));
  }
  if (Number.isFinite(maximumSpeed) && maximumSpeed >= 0) {
    const speed = Math.hypot(x, y);
    if (speed > maximumSpeed && speed > 0) {
      x *= maximumSpeed / speed;
      y *= maximumSpeed / speed;
    }
  }

  const rate = Math.max(0, finite(responseRate));
  const amount = 1 - Math.exp(-rate * safeDt);
  return {
    x: prior.x + (x - prior.x) * amount,
    y: prior.y + (y - prior.y) * amount,
  };
}

export function advanceInfluenceDynamics(influence, dt, {
  targetStrength = influence?.engaged ? 1.55 : 0,
  attackRate = 10,
  releaseRate = 4.5,
  engagedVelocityDecay = 1,
  releasedVelocityDecay = 4,
} = {}) {
  if (!(typeof dt === 'number' && Number.isFinite(dt)) || dt <= 0) return influence;
  const rate = influence.engaged ? attackRate : releaseRate;
  const amount = Math.min(1, dt * rate);
  influence.strength += (targetStrength - influence.strength) * amount;
  if (!influence.engaged && influence.strength < 1e-4) influence.strength = 0;
  const decay = Math.exp(-dt * (influence.engaged
    ? engagedVelocityDecay
    : releasedVelocityDecay));
  influence.velocity.x *= decay;
  influence.velocity.y *= decay;
  if (Math.abs(influence.velocity.x) < 1e-4) influence.velocity.x = 0;
  if (Math.abs(influence.velocity.y) < 1e-4) influence.velocity.y = 0;
  return influence;
}

// Explicit Fixed compatibility seam. The shader continues to receive its
// historical UV position and UV/second velocity without changing any gain.
export function canonicalInfluenceToFixed(influence, aspect = 1) {
  const safe = sanitizeSpatialInfluence(influence);
  const value = safe.ok ? safe.value : createSpatialInfluence();
  const a = normalizeAspect(aspect);
  const uv = surfaceToNormalizedViewport(value.position, a);
  return {
    x: uv.x,
    y: 1 - uv.y,
    vx: value.velocity.x / a,
    vy: value.velocity.y,
    radius: value.radius,
    strength: value.strength,
    active: value.positionValid,
  };
}
