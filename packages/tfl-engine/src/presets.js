// Presets: coherent multi-parameter configurations. Each preset alters fluid
// behavior, thickness response, optics, lighting and (sometimes) quality, so
// switching presets changes the material character, not just a color palette.
import { clampParam, defaultParams, transactParameters } from './state.js';
import { nextStateRandom } from './random.js';

export const PRESETS = {
  'Soap Film': {
    flowSpeed: 0.9, flowScale: 1.2, turbulence: 0.8, warp: 1.0, vorticity: 0.9,
    fineDetail: 0.9, filmBase: 430, thickVar: 0.85, drainage: 0.55, tension: 0.8,
    interf: 1.0, spread: 1.0, saturation: 1.05, exposure: 1.0, contrast: 1.05,
    fresnel: 0.9, specular: 1.0, sharpness: 110,
    azimuth: 135, elevation: 42, lightMotion: 0.3, highlight: 1.0, ambient: 0.35,
    grain: 0.008, temporal: 1.0,
  },
  'Oil Slick': {
    flowSpeed: 0.45, flowScale: 1.7, turbulence: 0.55, warp: 1.5, vorticity: 0.7,
    fineDetail: 0.6, filmBase: 620, thickVar: 1.05, drainage: 0.35, tension: 1.1,
    interf: 1.15, spread: 0.8, saturation: 1.2, exposure: 0.95, contrast: 1.12,
    fresnel: 1.1, specular: 1.25, sharpness: 160,
    azimuth: 200, elevation: 30, lightMotion: 0.18, highlight: 1.2, ambient: 0.28,
    grain: 0.007, temporal: 0.8,
  },
  'Deep Violet': {
    flowSpeed: 0.7, flowScale: 1.05, turbulence: 0.9, warp: 1.2, vorticity: 1.25,
    fineDetail: 1.0, filmBase: 250, thickVar: 0.55, drainage: 0.7, tension: 0.6,
    interf: 1.1, spread: 0.8, saturation: 1.35, exposure: 0.95, contrast: 1.15,
    fresnel: 1.0, specular: 0.9, sharpness: 90,
    azimuth: 90, elevation: 50, lightMotion: 0.4, highlight: 0.9, ambient: 0.3,
    grain: 0.009, temporal: 0.9,
  },
  'Electric Cells': {
    flowSpeed: 1.15, flowScale: 0.72, turbulence: 1.35, warp: 0.8, vorticity: 1.5,
    fineDetail: 1.4, filmBase: 520, thickVar: 1.0, drainage: 0.4, tension: 0.45,
    interf: 1.2, spread: 1.3, saturation: 1.25, exposure: 1.05, contrast: 1.1,
    fresnel: 0.8, specular: 1.1, sharpness: 70,
    azimuth: 160, elevation: 55, lightMotion: 0.55, highlight: 1.15, ambient: 0.38,
    grain: 0.0095, temporal: 1.15,
  },
  'Calm Membrane': {
    flowSpeed: 0.3, flowScale: 2.0, turbulence: 0.3, warp: 0.7, vorticity: 0.4,
    fineDetail: 0.4, filmBase: 380, thickVar: 0.45, drainage: 0.5, tension: 1.3,
    interf: 0.9, spread: 0.9, saturation: 0.9, exposure: 1.0, contrast: 1.0,
    fresnel: 0.8, specular: 0.85, sharpness: 200,
    azimuth: 120, elevation: 48, lightMotion: 0.12, highlight: 0.85, ambient: 0.42,
    grain: 0.006, temporal: 0.55,
  },
  'Chaotic Laboratory': {
    flowSpeed: 1.7, flowScale: 0.9, turbulence: 1.8, warp: 1.9, vorticity: 2.0,
    fineDetail: 1.7, filmBase: 560, thickVar: 1.25, drainage: 0.6, tension: 0.3,
    interf: 1.25, spread: 1.5, saturation: 1.2, exposure: 1.02, contrast: 1.08,
    fresnel: 0.9, specular: 1.0, sharpness: 60,
    azimuth: 250, elevation: 38, lightMotion: 0.7, highlight: 1.1, ambient: 0.32,
    grain: 0.011, temporal: 1.4,
  },
  'Mother of Pearl': {
    flowSpeed: 0.55, flowScale: 1.5, turbulence: 0.6, warp: 1.1, vorticity: 0.8,
    fineDetail: 0.7, filmBase: 240, thickVar: 0.5, drainage: 0.45, tension: 1.0,
    interf: 0.85, spread: 1.6, saturation: 0.75, exposure: 1.12, contrast: 0.95,
    fresnel: 1.2, specular: 1.3, sharpness: 240,
    azimuth: 110, elevation: 35, lightMotion: 0.22, highlight: 1.25, ambient: 0.5,
    grain: 0.0065, temporal: 0.7,
  },
};

export const PRESET_NAMES = Object.keys(PRESETS);

function isLocked(state, key) {
  return state.locks?.[key] === true;
}

export function applyPreset(state, name, { transition = 'smooth' } = {}) {
  const p = PRESETS[name];
  if (!p) {
    return transactParameters(state, null, { source: `preset:${name}` });
  }
  const report = transactParameters(state, p, {
    source: `preset:${name}`,
    transition,
    markPreset: false,
  });
  state.preset = report.skipped.length ? 'Custom' : name;
  return report;
}

// Controlled variation: perturb a subset of params within sensible bounds,
// preserving the general character of the current configuration.
export function mutate(state, random = null) {
  const rand = random ?? (() => nextStateRandom(state));
  const t = state.target;
  const pick = (arr, n) => {
    const c = [...arr];
    const out = [];
    while (out.length < n && c.length) out.push(c.splice(Math.floor(rand() * c.length), 1)[0]);
    return out;
  };
  const keys = pick([
    'flowSpeed', 'flowScale', 'turbulence', 'warp', 'vorticity', 'fineDetail',
    'filmBase', 'thickVar', 'drainage', 'tension', 'interf', 'spread',
    'saturation', 'sharpness', 'azimuth', 'elevation', 'highlight', 'ambient',
    'fresnel', 'specular', 'lightMotion', 'exposure', 'contrast',
  ].filter((k) => !isLocked(state, k)), 7 + Math.floor(rand() * 3));
  const changes = {};
  for (const k of keys) {
    const range = k === 'filmBase' ? 90 : k === 'azimuth' ? 60 : k === 'sharpness' ? 40 : null;
    const span = range ?? null;
    const cur = t[k];
    const delta = span !== null
      ? (rand() * 2 - 1) * span
      : cur * (rand() * 2 - 1) * 0.28;
    changes[k] = clampParam(k, cur + delta);
  }
  const report = transactParameters(state, changes, { source: 'mutate', markPreset: false });
  state.preset = 'Custom';
  return report;
}

// Full randomize: generate a fresh, independent visual configuration rather
// than multiplying the current values. This prevents repeated Randomize calls
// from getting trapped in a dark / low-exposure corner of parameter space.
// Rendering resolution is intentionally not randomized.
export function randomize(state, random = null) {
  const rand = random ?? (() => nextStateRandom(state));
  const changes = {};
  const set = (k, lo, hi) => {
    if (!isLocked(state, k)) changes[k] = clampParam(k, lo + rand() * (hi - lo));
  };

  set('flowSpeed', 0.20, 1.85);
  set('flowScale', 0.65, 2.45);
  set('turbulence', 0.20, 1.75);
  set('warp', 0.25, 2.05);
  set('vorticity', 0.20, 2.10);
  set('fineDetail', 0.15, 1.65);
  set('filmBase', 130, 820);
  set('thickVar', 0.28, 1.35);
  set('drainage', 0.12, 1.12);
  set('tension', 0.25, 1.38);

  set('interf', 0.65, 1.38);
  set('spread', 0.50, 1.90);
  set('saturation', 0.72, 1.48);
  set('exposure', 0.84, 1.24);
  set('contrast', 0.86, 1.25);
  set('fresnel', 0.45, 1.42);
  set('specular', 0.52, 1.55);
  set('sharpness', 28, 275);

  set('azimuth', 0, 360);
  set('elevation', 15, 72);
  set('lightMotion', 0.05, 0.82);
  set('highlight', 0.58, 1.52);
  set('ambient', 0.24, 0.68);

  set('temporal', 0.35, 1.65);
  set('grain', 0.002, 0.014);

  const report = transactParameters(state, changes, { source: 'randomize', markPreset: false });
  state.preset = 'Custom';
  return report;
}

// Fixed's ordinary Reset preserves quality, MSAA and every locked numeric
// value. The application remains responsible for UI preferences and storage.
export function resetParameters(state) {
  const quality = state.quality;
  const msaa = state.msaa;
  const report = transactParameters(state, {
    ...defaultParams(),
    ...PRESETS['Soap Film'],
  }, {
    source: 'reset',
    markPreset: false,
  });
  state.preset = report.skipped.length ? 'Custom' : 'Soap Film';
  state.quality = quality;
  state.msaa = msaa;
  return report;
}
