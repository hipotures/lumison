// Optional velocity-driven displacement for a continuous spatial influence.
// The response consumes canonical surface units and contains no browser or
// pointer semantics. It is disabled by default so Fixed compatibility remains
// the zero-response path.

export const MOTION_WARP_DEFAULTS = Object.freeze({
  enabled: false,
  gain: 1,
  radius: 0.19,
});

export const MOTION_WARP_LIMITS = Object.freeze({
  gain: Object.freeze([0, 2]),
  radius: Object.freeze([0.03, 0.5]),
});

// Qwen V1 multiplied a frame-smoothed velocity by an event-count-dependent
// strength. Canonical velocity already has real units, so this calibration
// maps speed monotonically to a bounded displacement instead.
export const MOTION_WARP_CALIBRATION = Object.freeze({
  speedStart: 0.04,
  speedFull: 1.5,
  maximumDisplacement: 0.04,
  attackRate: 18,
  releaseRate: 6,
});

const CONFIGURATION_KEYS = Object.keys(MOTION_WARP_DEFAULTS);

export function createMotionWarpState(configuration = {}) {
  const state = {
    configuration: { ...MOTION_WARP_DEFAULTS },
    position: { x: 0, y: 0 },
    positionValid: false,
    sourceVelocity: { x: 0, y: 0 },
    sourceSpeed: 0,
    displacement: { x: 0, y: 0 },
    effectiveStrength: 0,
  };
  configureMotionWarp(state, configuration);
  return state;
}

export function configureMotionWarp(state, changes) {
  const report = {
    source: 'motion-warp',
    ok: true,
    changed: false,
    accepted: [],
    rejected: [],
  };
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    report.ok = false;
    report.rejected.push({ name: null, reason: 'changes-must-be-an-object' });
    return report;
  }

  for (const [name, value] of Object.entries(changes)) {
    if (!CONFIGURATION_KEYS.includes(name)) {
      report.rejected.push({ name, value, reason: 'unknown-motion-warp-setting' });
      continue;
    }
    if (name === 'enabled') {
      if (typeof value !== 'boolean') {
        report.rejected.push({ name, value, reason: 'enabled-must-be-boolean' });
        continue;
      }
    } else {
      const [minimum, maximum] = MOTION_WARP_LIMITS[name];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        report.rejected.push({ name, value, reason: 'value-must-be-finite-number' });
        continue;
      }
      if (value < minimum || value > maximum) {
        report.rejected.push({ name, value, minimum, maximum, reason: 'value-out-of-range' });
        continue;
      }
    }
    if (state.configuration[name] !== value) report.changed = true;
    state.configuration[name] = value;
    report.accepted.push({ name, value });
  }

  report.ok = report.rejected.length === 0;
  if (!state.configuration.enabled || state.configuration.gain === 0) {
    clearMotionWarpResponse(state);
  }
  return report;
}

export function advanceMotionWarp(state, influence, dt) {
  if (!(typeof dt === 'number' && Number.isFinite(dt)) || dt < 0) return false;
  const positionValid = influence?.positionValid === true
    && finitePoint(influence.position);
  const velocity = positionValid && finitePoint(influence?.velocity)
    ? influence.velocity
    : { x: 0, y: 0 };
  const speed = Math.hypot(velocity.x, velocity.y);

  if (positionValid) {
    state.position.x = influence.position.x;
    state.position.y = influence.position.y;
  }
  state.positionValid = positionValid;
  state.sourceVelocity.x = velocity.x;
  state.sourceVelocity.y = velocity.y;
  state.sourceSpeed = speed;

  if (!state.configuration.enabled || state.configuration.gain === 0) {
    clearMotionWarpResponse(state);
    return true;
  }
  if (dt === 0) return true;

  const drive = motionDriveForSpeed(speed);
  const magnitude = MOTION_WARP_CALIBRATION.maximumDisplacement
    * state.configuration.gain * drive;
  const inverseSpeed = speed > 0 ? 1 / speed : 0;
  const targetX = velocity.x * inverseSpeed * magnitude;
  const targetY = velocity.y * inverseSpeed * magnitude;
  const targetStrength = Math.hypot(targetX, targetY);
  const rate = targetStrength > state.effectiveStrength
    ? MOTION_WARP_CALIBRATION.attackRate
    : MOTION_WARP_CALIBRATION.releaseRate;
  const amount = 1 - Math.exp(-rate * dt);
  state.displacement.x += (targetX - state.displacement.x) * amount;
  state.displacement.y += (targetY - state.displacement.y) * amount;
  state.effectiveStrength = Math.hypot(state.displacement.x, state.displacement.y);

  if (state.effectiveStrength < 1e-7) {
    state.displacement.x = 0;
    state.displacement.y = 0;
    state.effectiveStrength = 0;
  }
  return true;
}

export function motionDriveForSpeed(speed) {
  if (!(typeof speed === 'number' && Number.isFinite(speed)) || speed <= 0) return 0;
  const { speedStart, speedFull } = MOTION_WARP_CALIBRATION;
  const t = Math.min(1, Math.max(0, (speed - speedStart) / (speedFull - speedStart)));
  return t * t * (3 - 2 * t);
}

export function motionWarpConfiguration(state) {
  return { ...state.configuration };
}

export function motionWarpRenderState(state) {
  return {
    enabled: state.configuration.enabled,
    gain: state.configuration.gain,
    radius: state.configuration.radius,
    position: { ...state.position },
    positionValid: state.positionValid,
    displacement: { ...state.displacement },
    effectiveStrength: state.effectiveStrength,
    sourceSpeed: state.sourceSpeed,
  };
}

export function snapshotMotionWarpRuntime(state) {
  return {
    position: { ...state.position },
    positionValid: state.positionValid,
    sourceVelocity: { ...state.sourceVelocity },
    sourceSpeed: state.sourceSpeed,
    displacement: { ...state.displacement },
    effectiveStrength: state.effectiveStrength,
  };
}

export function restoreMotionWarpRuntime(state, saved) {
  if (!saved || typeof saved !== 'object'
    || !finitePoint(saved.position)
    || !finitePoint(saved.sourceVelocity)
    || !finitePoint(saved.displacement)
    || typeof saved.positionValid !== 'boolean'
    || !finiteNonnegative(saved.sourceSpeed)
    || !finiteNonnegative(saved.effectiveStrength)) return false;
  if (Math.abs(Math.hypot(saved.sourceVelocity.x, saved.sourceVelocity.y) - saved.sourceSpeed) > 1e-9
    || Math.abs(Math.hypot(saved.displacement.x, saved.displacement.y)
      - saved.effectiveStrength) > 1e-9) return false;
  state.position = { ...saved.position };
  state.positionValid = saved.positionValid;
  state.sourceVelocity = { ...saved.sourceVelocity };
  state.sourceSpeed = saved.sourceSpeed;
  state.displacement = { ...saved.displacement };
  state.effectiveStrength = saved.effectiveStrength;
  if (!state.configuration.enabled || state.configuration.gain === 0) {
    clearMotionWarpResponse(state);
  }
  return true;
}

// Pure mirror of the shader's Gaussian spatial envelope. Useful for control
// tests and diagnostics; it does not evaluate the procedural film field.
export function motionWarpDisplacementAt(state, position) {
  if (!state.configuration.enabled || state.effectiveStrength === 0
    || !finitePoint(position)) return { x: 0, y: 0 };
  const dx = position.x - state.position.x;
  const dy = position.y - state.position.y;
  const radius = state.configuration.radius;
  const envelope = Math.exp(-(dx * dx + dy * dy) / (radius * radius));
  return {
    x: state.displacement.x * envelope,
    y: state.displacement.y * envelope,
  };
}

function clearMotionWarpResponse(state) {
  state.displacement.x = 0;
  state.displacement.y = 0;
  state.effectiveStrength = 0;
}

function finitePoint(point) {
  return point && typeof point.x === 'number' && Number.isFinite(point.x)
    && typeof point.y === 'number' && Number.isFinite(point.y);
}

function finiteNonnegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
