// Central application state: schema, defaults, validation, persistence.
//
// Single source of truth. All UI inputs (sliders, presets, mutate, reset,
// import, adaptive quality) converge here. The renderer reads smoothed values
// from `state.current` each frame; UI writes to `state.target`.
//
// Numeric params are smoothed toward targets every frame so preset switches
// and dramatic slider moves transition continuously instead of popping.

const STORAGE_KEY = 'thin-film-lab.v1';
const SCHEMA_VERSION = 1;

export const QUALITY_LEVELS = ['Low', 'Medium', 'High', 'Ultra'];
export const DIAG_MODES = ['Final', 'Thickness', 'Normal', 'Flow', 'Interference', 'Lighting'];
export const TARGET_FPS_OPTIONS = [30, 60, 90, 120];

// name: [min, max, step, def, group, label]
const DEFS = {
  // ---- simulation / fluid ----
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
  // ---- optics ----
  interf:      [0.0, 1.5, 0.01, 1.00, 'opt', 'Interference Strength'],
  spread:      [0.2, 2.5, 0.01, 1.00, 'opt', 'Spectral Spread'],
  saturation:  [0.0, 2.0, 0.01, 1.05, 'opt', 'Saturation'],
  exposure:    [0.2, 2.2, 0.01, 1.00, 'opt', 'Exposure'],
  contrast:    [0.5, 1.8, 0.01, 1.05, 'opt', 'Contrast'],
  fresnel:     [0.0, 2.0, 0.01, 0.90, 'opt', 'Fresnel Strength'],
  specular:    [0.0, 2.5, 0.01, 1.00, 'opt', 'Specular Strength'],
  sharpness:   [8, 320, 1, 110, 'opt', 'Specular Sharpness'],
  // ---- lighting ----
  azimuth:     [0, 360, 1, 135, 'lit', 'Light Azimuth (°)'],
  elevation:   [5, 85, 1, 42, 'lit', 'Light Elevation (°)'],
  lightMotion: [0.0, 1.5, 0.01, 0.30, 'lit', 'Light Motion Speed'],
  highlight:   [0.0, 2.0, 0.01, 1.00, 'lit', 'Highlight Intensity'],
  ambient:     [0.0, 1.0, 0.01, 0.35, 'lit', 'Ambient Light'],
  // ---- rendering ----
  renderScale: [0.25, 1.5, 0.05, 1.00, 'ren', 'Render Scale'],
  temporal:    [0.0, 2.5, 0.01, 1.00, 'ren', 'Temporal Speed'],
  grain:       [0.0, 0.08, 0.001, 0.008, 'ren', 'Grain / Dither'],
};

export const PARAM_DEFS = DEFS;
export const PARAM_NAMES = Object.keys(DEFS);

export function defaultParams() {
  const o = {};
  for (const [k, d] of Object.entries(DEFS)) o[k] = d[3];
  return o;
}

export function clampParam(name, v) {
  const d = DEFS[name];
  if (!d || typeof v !== 'number' || !Number.isFinite(v)) return d ? d[3] : 0;
  return Math.min(d[1], Math.max(d[0], v));
}

function sanitizeParams(raw) {
  const clean = defaultParams();
  if (raw && typeof raw === 'object') {
    for (const k of PARAM_NAMES) {
      if (typeof raw[k] === 'number' && Number.isFinite(raw[k])) {
        clean[k] = clampParam(k, raw[k]);
      }
    }
  }
  return clean;
}

function sanitizeEnum(v, list, fallback) {
  return list.includes(v) ? v : fallback;
}

export function createState() {
  const reduceMotion = typeof matchMedia === 'function'
    && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const state = {
    target: defaultParams(),
    current: defaultParams(),
    preset: 'Soap Film',
    quality: 'High',
    diag: 'Final',
    msaa: 0,               // 0 | 2 | 4
    adaptive: true,
    targetFps: 60,
    paused: false,
    probe: false,
    panelOpen: true,
    panelCollapsed: {},    // sectionId -> bool
    locks: {},             // paramName -> true; only Factory Reset bypasses locks
    simTime: 0,
    reduceMotion,
  };
  if (reduceMotion) {
    state.target.temporal = 0.35;
    state.current.temporal = 0.35;
  }
  return state;
}

// Frame-rate independent exponential smoothing of every numeric param.
export function smoothState(state, dt) {
  const k = Math.min(1, dt * 3.2);
  const t = state.target, c = state.current;
  for (const key of PARAM_NAMES) {
    const d = t[key] - c[key];
    if (d !== 0) c[key] = Math.abs(d) < 1e-5 ? t[key] : c[key] + d * k;
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
    probe: state.probe,
    panelOpen: state.panelOpen,
    locks: { ...state.locks },
    params: { ...state.target },
  };
}

export function applySnapshot(state, snap, options = {}) {
  if (!snap || typeof snap !== 'object') return false;
  if (snap.version !== SCHEMA_VERSION) return false;

  const preserveLocks = options.preserveLocks === true;
  const previousLocks = { ...(state.locks || {}) };
  const previousTarget = { ...state.target };
  const params = sanitizeParams(snap.params);

  if (preserveLocks) {
    for (const k of PARAM_NAMES) {
      if (previousLocks[k] === true) params[k] = previousTarget[k];
    }
  }
  state.target = params;

  // Restores may bring their own locks. Imports intentionally preserve the
  // live lock set so a locked value cannot be changed by importing settings.
  if (preserveLocks) {
    state.locks = previousLocks;
  } else {
    state.locks = {};
    if (snap.locks && typeof snap.locks === 'object') {
      for (const k of PARAM_NAMES) {
        if (snap.locks[k] === true) state.locks[k] = true;
      }
    }
  }

  // Snap fast-moving render params immediately to avoid long drifts.
  state.current.renderScale = params.renderScale;
  state.quality = sanitizeEnum(snap.quality, QUALITY_LEVELS, state.quality);
  state.diag = sanitizeEnum(snap.diag, DIAG_MODES, 'Final');
  state.msaa = [0, 2, 4].includes(snap.msaa) ? snap.msaa : 0;
  state.adaptive = snap.adaptive !== false;
  state.targetFps = sanitizeEnum(snap.targetFps, TARGET_FPS_OPTIONS, 60);
  state.probe = snap.probe === true;
  if (typeof snap.preset === 'string') state.preset = preserveLocks && Object.keys(state.locks).length ? 'Custom' : snap.preset;
  if (typeof snap.panelOpen === 'boolean') state.panelOpen = snap.panelOpen;
  return true;
}

export function persist(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot(state)));
  } catch {
    // Persistence is optional; startup must never fail because of it.
  }
}

export function restore(state) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    return applySnapshot(state, JSON.parse(raw));
  } catch {
    return false;
  }
}

export function factoryReset(state) {
  const fresh = createState();
  fresh.reduceMotion = state.reduceMotion;
  Object.assign(state, fresh);
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}
