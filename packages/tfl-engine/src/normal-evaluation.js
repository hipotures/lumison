// Surface-normal evaluation policy. This is engine rendering configuration,
// independent of browser input and scene parameters. Legacy Fixed remains the
// default; the optional displaced mode evaluates every height tap through the
// same spatial-displacement boundary as the center sample.

export const NORMAL_EVALUATION_MODES = Object.freeze({
  LEGACY_FIXED: 'Legacy Fixed',
  DISPLACED_GEOMETRY: 'Displaced Geometry',
});

export const NORMAL_EVALUATION_MODE_NAMES = Object.freeze(
  Object.values(NORMAL_EVALUATION_MODES),
);

export const NORMAL_EVALUATION_DEFAULTS = Object.freeze({
  mode: NORMAL_EVALUATION_MODES.LEGACY_FIXED,
});

export const NORMAL_EVALUATION_SHADER_MODES = Object.freeze({
  [NORMAL_EVALUATION_MODES.LEGACY_FIXED]: 0,
  [NORMAL_EVALUATION_MODES.DISPLACED_GEOMETRY]: 1,
});

// Only the optional displaced mode applies this defensive derivative limit.
// The bound is deliberately high relative to normal Fixed gradients and keeps
// finite but pathological height differences from producing unstable shading.
export const DISPLACED_NORMAL_GRADIENT_LIMIT = 64;

export function createNormalEvaluationState(configuration = {}) {
  const state = { configuration: { ...NORMAL_EVALUATION_DEFAULTS } };
  configureNormalEvaluation(state, configuration);
  return state;
}

export function configureNormalEvaluation(state, changes) {
  const report = {
    source: 'normal-evaluation',
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
    if (name !== 'mode') {
      report.rejected.push({ name, value, reason: 'unknown-normal-evaluation-setting' });
      continue;
    }
    if (!NORMAL_EVALUATION_MODE_NAMES.includes(value)) {
      report.rejected.push({
        name,
        value,
        reason: 'invalid-normal-evaluation-mode',
      });
      continue;
    }
    if (state.configuration.mode !== value) report.changed = true;
    state.configuration.mode = value;
    report.accepted.push({ name, value });
  }

  report.ok = report.rejected.length === 0;
  return report;
}

export function normalEvaluationConfiguration(state) {
  return { ...state.configuration };
}

export function normalEvaluationRenderState(state, quality = 'High') {
  const mode = state.configuration.mode;
  const central = quality !== 'Low';
  const displaced = mode === NORMAL_EVALUATION_MODES.DISPLACED_GEOMETRY;
  return {
    mode,
    shaderMode: NORMAL_EVALUATION_SHADER_MODES[mode],
    displacedGeometry: displaced,
    legacyExplicitTilt: !displaced,
    normalHeightSamples: displaced && !central ? 3 : central ? 4 : 2,
    displacementEvaluations: displaced ? (central ? 4 : 2) : 0,
  };
}

// Pure CPU reference for the sampling-coordinate policy. displacementAt
// returns an offset at a base coordinate. Legacy Fixed evaluates displacement
// once at the center and offsets that result; Displaced Geometry evaluates the
// same function independently at every neighboring base coordinate.
export function normalSamplingCoordinates({
  center,
  epsilon,
  mode = NORMAL_EVALUATION_DEFAULTS.mode,
  displacementAt = () => ({ x: 0, y: 0 }),
} = {}) {
  if (!finitePoint(center)
    || !finitePositive(epsilon)
    || !NORMAL_EVALUATION_MODE_NAMES.includes(mode)
    || typeof displacementAt !== 'function') return null;

  const bases = {
    center: { ...center },
    xPositive: { x: center.x + epsilon, y: center.y },
    xNegative: { x: center.x - epsilon, y: center.y },
    yPositive: { x: center.x, y: center.y + epsilon },
    yNegative: { x: center.x, y: center.y - epsilon },
  };
  const displacedCenter = applyDisplacement(bases.center, displacementAt);
  if (!displacedCenter) return null;

  if (mode === NORMAL_EVALUATION_MODES.LEGACY_FIXED) {
    return {
      center: displacedCenter,
      xPositive: { x: displacedCenter.x + epsilon, y: displacedCenter.y },
      xNegative: { x: displacedCenter.x - epsilon, y: displacedCenter.y },
      yPositive: { x: displacedCenter.x, y: displacedCenter.y + epsilon },
      yNegative: { x: displacedCenter.x, y: displacedCenter.y - epsilon },
    };
  }

  const result = { center: displacedCenter };
  for (const name of ['xPositive', 'xNegative', 'yPositive', 'yNegative']) {
    const displaced = applyDisplacement(bases[name], displacementAt);
    if (!displaced) return null;
    result[name] = displaced;
  }
  return result;
}

// CPU stability reference for the final normal construction. The GPU uses the
// same high derivative bound in Displaced Geometry mode and always retains a
// positive Z component before normalization.
export function stableNormalFromGradient(gx, gy, gradientScale = 1) {
  if (!finiteNumber(gx) || !finiteNumber(gy) || !finiteNumber(gradientScale)) {
    return { x: 0, y: 0, z: 1 };
  }
  const boundedX = clamp(gx, -DISPLACED_NORMAL_GRADIENT_LIMIT, DISPLACED_NORMAL_GRADIENT_LIMIT);
  const boundedY = clamp(gy, -DISPLACED_NORMAL_GRADIENT_LIMIT, DISPLACED_NORMAL_GRADIENT_LIMIT);
  const x = -boundedX * gradientScale;
  const y = -boundedY * gradientScale;
  const length = Math.hypot(x, y, 1);
  if (!Number.isFinite(length) || length <= 0) return { x: 0, y: 0, z: 1 };
  return { x: x / length, y: y / length, z: 1 / length };
}

function applyDisplacement(position, displacementAt) {
  const offset = displacementAt({ ...position });
  if (!finitePoint(offset)) return null;
  const result = { x: position.x + offset.x, y: position.y + offset.y };
  return finitePoint(result) ? result : null;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finitePositive(value) {
  return finiteNumber(value) && value > 0;
}

function finitePoint(value) {
  return finiteNumber(value?.x) && finiteNumber(value?.y);
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}
