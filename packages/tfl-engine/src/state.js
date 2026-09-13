// Fixed-compatible engine state: parameter schema, validation and snapshots.
// Browser persistence and Lab-only UI preferences live in apps/tfl-lab.

export const SCHEMA_VERSION = 1;
export const QUALITY_LEVELS = ['Low', 'Medium', 'High', 'Ultra'];
export const DIAG_MODES = ['Final', 'Thickness', 'Normal', 'Flow', 'Interference', 'Lighting'];
export const TARGET_FPS_OPTIONS = [30, 60, 90, 120];

// name: [min, max, step, default, UI group, label]
const DEFS = {
  flowSpeed:   [0.0, 2.5, 0.01, 1.00, 'sim', 'Flow Speed'],
  flowScale:   [0.4, 3.5, 0.01, 1.30, 'sim', 'Flow Scale'],
  turbulence:  [0.0, 2.0, 0.01, 1.00, 'sim', 'Turbulence'],
  warp:        [0.0, 2.5, 0.01, 1.10, 'sim', 'Domain Warp'],
  vorticity:   [0.0, 2.5, 0.01, 1.00, 'sim', 'Vorticity'],
  fineDetail:  [0.0, 2.0, 0.01, 1.00, 'sim', 'Fine Detail'],
  filmBase:    [80, 1000, 1, 430, 'sim', 'Film Thickness (nm)'],
  thickVar:    [0.0, 1.6, 0.01, 0.85, 'sim', 'Thickness Variation'],
  drainage:    [0.0, 1.5, 0.01, 0.55, 'sim', 'Drainage Bias'],
  tension:     [0.0, 1.5, 0.01, 0.80, 'sim', 'Surface Tension'],
  interf:      [0.0, 1.5, 0.01, 1.00, 'opt', 'Interference Strength'],
  spread:      [0.2, 2.5, 0.01, 1.00, 'opt', 'Spectral Spread'],
  saturation:  [0.0, 2.0, 0.01, 1.05, 'opt', 'Saturation'],
  exposure:    [0.2, 2.2, 0.01, 1.00, 'opt', 'Exposure'],
  contrast:    [0.5, 1.8, 0.01, 1.05, 'opt', 'Contrast'],
  fresnel:     [0.0, 2.0, 0.01, 0.90, 'opt', 'Fresnel Strength'],
  specular:    [0.0, 2.5, 0.01, 1.00, 'opt', 'Specular Strength'],
  sharpness:   [8, 320, 1, 110, 'opt', 'Specular Sharpness'],
  azimuth:     [0, 360, 1, 135, 'lit', 'Light Azimuth (°)'],
  elevation:   [5, 85, 1, 42, 'lit', 'Light Elevation (°)'],
  lightMotion: [0.0, 1.5, 0.01, 0.30, 'lit', 'Light Motion Speed'],
  highlight:   [0.0, 2.0, 0.01, 1.00, 'lit', 'Highlight Intensity'],
  ambient:     [0.0, 1.0, 0.01, 0.35, 'lit', 'Ambient Light'],
  renderScale: [0.25, 1.5, 0.05, 1.00, 'ren', 'Render Scale'],
  temporal:    [0.0, 2.5, 0.01, 1.00, 'ren', 'Temporal Speed'],
  grain:       [0.0, 0.08, 0.001, 0.008, 'ren', 'Grain / Dither'],
};

export const PARAM_DEFS = DEFS;
export const PARAM_NAMES = Object.keys(DEFS);

export function defaultParams() {
  const params = {};
  for (const [name, definition] of Object.entries(DEFS)) params[name] = definition[3];
  return params;
}

export function clampParam(name, value) {
  const definition = DEFS[name];
  if (!definition || typeof value !== 'number' || !Number.isFinite(value)) {
    return definition ? definition[3] : 0;
  }
  return Math.min(definition[1], Math.max(definition[0], value));
}

function sanitizeParams(raw) {
  const clean = defaultParams();
  if (raw && typeof raw === 'object') {
    for (const name of PARAM_NAMES) {
      if (typeof raw[name] === 'number' && Number.isFinite(raw[name])) {
        clean[name] = clampParam(name, raw[name]);
      }
    }
  }
  return clean;
}

function sanitizeEnum(value, values, fallback) {
  return values.includes(value) ? value : fallback;
}

export function createState({ reduceMotion = false } = {}) {
  const state = {
    target: defaultParams(),
    current: defaultParams(),
    preset: 'Soap Film',
    quality: 'High',
    diag: 'Final',
    msaa: 0,
    adaptive: true,
    targetFps: 60,
    paused: false,
    locks: {},
    simTime: 0,
    reduceMotion: reduceMotion === true,
  };
  if (state.reduceMotion) {
    state.target.temporal = 0.35;
    state.current.temporal = 0.35;
  }
  return state;
}

export function smoothState(state, dt) {
  const amount = Math.min(1, dt * 3.2);
  for (const name of PARAM_NAMES) {
    const difference = state.target[name] - state.current[name];
    if (difference !== 0) {
      state.current[name] = Math.abs(difference) < 1e-5
        ? state.target[name]
        : state.current[name] + difference * amount;
    }
  }
}

export function snapshot(state) {
  return {
    version: SCHEMA_VERSION,
    preset: state.preset,
    quality: state.quality,
    diag: state.diag,
    msaa: state.msaa,
    adaptive: state.adaptive,
    targetFps: state.targetFps,
    paused: false,
    locks: { ...state.locks },
    params: { ...state.target },
  };
}

export function applySnapshot(state, saved, { preserveLocks = false } = {}) {
  if (!saved || typeof saved !== 'object' || saved.version !== SCHEMA_VERSION) return false;

  const previousLocks = { ...(state.locks || {}) };
  const previousTarget = { ...state.target };
  const params = sanitizeParams(saved.params);
  if (preserveLocks) {
    for (const name of PARAM_NAMES) {
      if (previousLocks[name] === true) params[name] = previousTarget[name];
    }
  }
  state.target = params;
  state.locks = {};
  if (preserveLocks) {
    state.locks = previousLocks;
  } else if (saved.locks && typeof saved.locks === 'object') {
    for (const name of PARAM_NAMES) {
      if (saved.locks[name] === true) state.locks[name] = true;
    }
  }

  state.current.renderScale = params.renderScale;
  state.quality = sanitizeEnum(saved.quality, QUALITY_LEVELS, state.quality);
  state.diag = sanitizeEnum(saved.diag, DIAG_MODES, 'Final');
  state.msaa = [0, 2, 4].includes(saved.msaa) ? saved.msaa : 0;
  state.adaptive = saved.adaptive !== false;
  state.targetFps = sanitizeEnum(saved.targetFps, TARGET_FPS_OPTIONS, 60);
  if (typeof saved.preset === 'string') {
    state.preset = preserveLocks && Object.keys(state.locks).length ? 'Custom' : saved.preset;
  }
  return true;
}

export function setParameter(state, name, value) {
  if (!DEFS[name] || state.locks?.[name]) return false;
  state.target[name] = clampParam(name, value);
  state.preset = 'Custom';
  return true;
}

export function resetParameter(state, name) {
  if (!DEFS[name] || state.locks?.[name]) return false;
  state.target[name] = DEFS[name][3];
  return true;
}

export function setParameterLock(state, name, locked) {
  if (!DEFS[name]) return false;
  if (locked) {
    state.locks[name] = true;
    state.current[name] = state.target[name];
  } else {
    delete state.locks[name];
  }
  return true;
}

export function factoryResetState(state) {
  const fresh = createState({ reduceMotion: state.reduceMotion });
  for (const [key, value] of Object.entries(fresh)) state[key] = value;
}
