// Canonical engine state and the authoritative numeric parameter transaction
// path. Browser persistence and Lab-only UI preferences live in apps/tfl-lab.
import { CLOCK_NAMES, createClocks } from './clocks.js';
import { DEFAULT_MUTATION_SEED, DEFAULT_VISUAL_SEED, normalizeSeed } from './random.js';

export const SCHEMA_VERSION = 2;
export const LEGACY_SCHEMA_VERSION = 1;
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
export const PARAM_SCHEMA = Object.freeze(Object.fromEntries(
  Object.entries(DEFS).map(([name, definition]) => [name, Object.freeze({
    minimum: definition[0],
    maximum: definition[1],
    step: definition[2],
    default: definition[3],
    group: definition[4],
    label: definition[5],
    unit: name === 'filmBase' ? 'nm' : 'artistic',
  })]),
));

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

export function createState({
  reduceMotion = false,
  visualSeed = DEFAULT_VISUAL_SEED,
  mutationSeed = DEFAULT_MUTATION_SEED,
} = {}) {
  const defaults = defaultParams();
  const state = {
    requested: { ...defaults },
    target: { ...defaults },
    current: { ...defaults },
    effective: { ...defaults },
    preset: 'Soap Film',
    quality: 'High',
    diag: 'Final',
    msaa: 0,
    adaptive: true,
    targetFps: 60,
    paused: false,
    locks: {},
    clocks: createClocks(),
    seeds: {
      visual: normalizeSeed(visualSeed, DEFAULT_VISUAL_SEED),
      mutation: normalizeSeed(mutationSeed, DEFAULT_MUTATION_SEED),
    },
    sequences: { mutation: 0 },
    reduceMotion: reduceMotion === true,
    lastTransaction: emptyTransaction('initialize'),
  };
  if (state.reduceMotion) {
    state.requested.temporal = 0.35;
    state.target.temporal = 0.35;
    state.current.temporal = 0.35;
    state.effective.temporal = 0.35;
  }
  return state;
}

export function transactParameters(state, changes, {
  source = 'unknown',
  transition = 'smooth',
  preset = 'Custom',
  markPreset = true,
} = {}) {
  const report = emptyTransaction(source);
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    report.rejected.push({ name: null, reason: 'changes-must-be-an-object' });
    report.ok = false;
    state.lastTransaction = report;
    return report;
  }

  for (const [name, requestedValue] of Object.entries(changes)) {
    const definition = DEFS[name];
    if (!definition) {
      report.rejected.push({ name, value: requestedValue, reason: 'unknown-parameter' });
      continue;
    }
    if (state.locks?.[name] === true) {
      report.skipped.push({ name, value: requestedValue, reason: 'locked' });
      continue;
    }
    if (typeof requestedValue !== 'number' || !Number.isFinite(requestedValue)) {
      report.rejected.push({ name, value: requestedValue, reason: 'value-must-be-finite-number' });
      continue;
    }
    const value = clampParam(name, requestedValue);
    state.requested[name] = value;
    state.target[name] = value;
    if (transition === 'immediate') {
      state.current[name] = value;
      state.effective[name] = value;
    }
    report.accepted.push({
      name,
      requestedValue,
      value,
      clamped: value !== requestedValue,
    });
  }

  report.ok = report.rejected.length === 0;
  report.changed = report.accepted.length > 0;
  if (markPreset && report.changed) state.preset = report.skipped.length ? 'Custom' : preset;
  state.lastTransaction = report;
  return report;
}

export function smoothState(state, dt) {
  if (!(typeof dt === 'number' && Number.isFinite(dt)) || dt <= 0) return;
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

export function synchronizeEffectiveParameters(state, { renderScale } = {}) {
  for (const name of PARAM_NAMES) state.effective[name] = state.current[name];
  if (typeof renderScale === 'number' && Number.isFinite(renderScale)) {
    state.effective.renderScale = clampParam('renderScale', renderScale);
  }
  return state.effective;
}

export function createSnapshot(state, { includeRuntime = false } = {}) {
  const saved = {
    version: SCHEMA_VERSION,
    profile: 'fixed-compatibility',
    preset: state.preset,
    quality: state.quality,
    diag: state.diag,
    msaa: state.msaa,
    adaptive: state.adaptive,
    targetFps: state.targetFps,
    paused: false,
    locks: { ...state.locks },
    parameters: {
      requested: { ...state.requested },
      target: { ...state.target },
    },
    seeds: { ...state.seeds },
    sequences: { mutation: state.sequences.mutation },
  };
  if (includeRuntime) {
    saved.runtime = {
      paused: state.paused,
      current: { ...state.current },
      effective: { ...state.effective },
      clocks: { ...state.clocks },
    };
  }
  return saved;
}

export const snapshot = createSnapshot;

export function applySnapshot(state, saved, {
  preserveLocks = false,
  restoreRuntime = false,
} = {}) {
  if (!saved || typeof saved !== 'object'
    || ![LEGACY_SCHEMA_VERSION, SCHEMA_VERSION].includes(saved.version)) {
    return failedSnapshot('unsupported-snapshot-version');
  }
  const raw = saved.version === LEGACY_SCHEMA_VERSION
    ? saved.params
    : (saved.parameters?.target ?? saved.parameters?.requested);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return failedSnapshot('snapshot-parameters-missing');
  }
  if (restoreRuntime && (saved.version !== SCHEMA_VERSION || !validRuntimeState(saved.runtime))) {
    return failedSnapshot('invalid-or-missing-runtime-state');
  }

  const patch = defaultParams();
  for (const name of PARAM_NAMES) {
    if (!Object.hasOwn(raw, name)) continue;
    if (typeof raw[name] !== 'number' || !Number.isFinite(raw[name])) {
      return failedSnapshot(`invalid-snapshot-parameter:${name}`);
    }
    patch[name] = raw[name];
  }
  const previousLocks = { ...state.locks };
  if (!preserveLocks) state.locks = {};
  const transaction = transactParameters(state, patch, {
    source: saved.version === LEGACY_SCHEMA_VERSION ? 'snapshot-v1' : 'snapshot-v2',
    transition: 'immediate',
    markPreset: false,
  });

  if (preserveLocks) {
    state.locks = previousLocks;
  } else {
    state.locks = sanitizeLocks(saved.locks);
  }
  state.quality = sanitizeEnum(saved.quality, QUALITY_LEVELS, state.quality);
  state.diag = sanitizeEnum(saved.diag, DIAG_MODES, 'Final');
  state.msaa = [0, 2, 4].includes(saved.msaa) ? saved.msaa : 0;
  state.adaptive = saved.adaptive !== false;
  state.targetFps = sanitizeEnum(saved.targetFps, TARGET_FPS_OPTIONS, 60);
  if (typeof saved.preset === 'string') {
    state.preset = preserveLocks && Object.keys(state.locks).length ? 'Custom' : saved.preset;
  }

  if (saved.version === SCHEMA_VERSION) {
    state.seeds.visual = normalizeSeed(saved.seeds?.visual, state.seeds.visual);
    state.seeds.mutation = normalizeSeed(saved.seeds?.mutation, state.seeds.mutation);
    state.sequences.mutation = normalizeSeed(saved.sequences?.mutation, 0);
  }
  if (restoreRuntime && saved.version === SCHEMA_VERSION && saved.runtime) {
    restoreRuntimeState(state, saved.runtime);
  } else {
    synchronizeEffectiveParameters(state, { renderScale: state.current.renderScale });
  }
  return { ok: true, transaction, migrated: saved.version === LEGACY_SCHEMA_VERSION };
}

export function setParameter(state, name, value) {
  return transactParameters(state, { [name]: value }, { source: 'parameter' });
}

export function resetParameter(state, name) {
  if (!DEFS[name]) {
    return transactParameters(state, { [name]: undefined }, { source: 'parameter-reset' });
  }
  return transactParameters(state, { [name]: DEFS[name][3] }, {
    source: 'parameter-reset',
    preset: state.preset,
    markPreset: false,
  });
}

export function setParameterLock(state, name, locked) {
  if (!DEFS[name]) return false;
  if (locked) {
    state.locks[name] = true;
    state.current[name] = state.target[name];
    state.effective[name] = state.target[name];
  } else {
    delete state.locks[name];
  }
  return true;
}

export function factoryResetState(state) {
  const fresh = createState({
    reduceMotion: state.reduceMotion,
    visualSeed: DEFAULT_VISUAL_SEED,
    mutationSeed: DEFAULT_MUTATION_SEED,
  });
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, fresh);
}

function emptyTransaction(source) {
  return {
    source,
    ok: true,
    changed: false,
    accepted: [],
    skipped: [],
    rejected: [],
  };
}

function failedSnapshot(reason) {
  return { ok: false, reason, transaction: null, migrated: false };
}

function sanitizeEnum(value, values, fallback) {
  return values.includes(value) ? value : fallback;
}

function sanitizeLocks(raw) {
  const locks = {};
  if (raw && typeof raw === 'object') {
    for (const name of PARAM_NAMES) if (raw[name] === true) locks[name] = true;
  }
  return locks;
}

function restoreRuntimeState(state, runtime) {
  state.paused = runtime.paused === true;
  state.clocks = createClocks(runtime.clocks);
  for (const name of PARAM_NAMES) {
    const current = runtime.current?.[name];
    const effective = runtime.effective?.[name];
    state.current[name] = typeof current === 'number' && Number.isFinite(current)
      ? clampParam(name, current)
      : state.target[name];
    state.effective[name] = typeof effective === 'number' && Number.isFinite(effective)
      ? clampParam(name, effective)
      : state.current[name];
  }
}

function validRuntimeState(runtime) {
  if (!runtime || typeof runtime !== 'object'
    || !runtime.current || !runtime.effective || !runtime.clocks
    || typeof runtime.paused !== 'boolean') return false;
  for (const name of PARAM_NAMES) {
    for (const layer of ['current', 'effective']) {
      const value = runtime[layer][name];
      if (typeof value !== 'number' || !Number.isFinite(value)
        || clampParam(name, value) !== value) return false;
    }
  }
  return CLOCK_NAMES.every((name) => {
    const value = runtime.clocks[name];
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
  });
}
