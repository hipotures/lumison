import { fifthsCoordinates } from '../music/tonality.js';

// All targets already exist in the public TFL parameter schema. Polarity is a
// signed user choice, not a major-bright/minor-dark artistic rule.
export const TONAL_TARGETS = Object.freeze({
  filmBase: 'Tonic', flowScale: 'Tonic', interf: 'Tonic', spread: 'Tonic', azimuth: 'Tonic',
  thickVar: 'Mode', tension: 'Mode', saturation: 'Mode', contrast: 'Mode',
});

export function tonalOffsets(harmony, key) {
  const offsets = {};
  if (!harmony.analysis.enabled || !harmony.mapping.enabled || !key) return offsets;
  const coordinates = fifthsCoordinates(key.tonicPitchClass);
  for (const [name, source] of Object.entries(TONAL_TARGETS)) {
    const control = harmony.mapping.targets[name];
    if (!control.enabled || control.amount === 0 || harmony.mapping.influence === 0) continue;
    const phase = (control.phaseDegrees ?? 0) * Math.PI / 180;
    const input = source === 'Tonic'
      ? coordinates.x * Math.cos(phase) + coordinates.y * Math.sin(phase)
      : (key.mode === 'major' ? 1 : -1);
    offsets[name] = input * control.amount * harmony.mapping.influence;
  }
  return offsets;
}

export class TonalTransition {
  constructor() { this.reset(); }
  reset() { this.transitions = new Map(); }
  sample(entry, time) {
    const t = entry.duration > 0 ? Math.max(0, Math.min(1, (time - entry.start) / entry.duration)) : 1;
    const eased = t * t * (3 - 2 * t);
    return entry.from + (entry.to - entry.from) * eased;
  }
  update(harmony, key, time, { seek = false } = {}) {
    const targets = tonalOffsets(harmony, key);
    const result = {};
    for (const name of Object.keys(TONAL_TARGETS)) {
      const control = harmony.mapping.targets[name];
      // Disabled/zero controls immediately remove only their own contribution.
      if (!harmony.analysis.enabled || !harmony.mapping.enabled || !control.enabled
        || control.amount === 0 || harmony.mapping.influence === 0) {
        this.transitions.delete(name); continue;
      }
      const target = targets[name] ?? 0;
      let entry = this.transitions.get(name);
      const duration = seek ? harmony.mapping.seekTransitionSeconds : harmony.mapping.transitionSeconds;
      if (seek || !entry || entry.to !== target || entry.setting !== harmony.mapping.transitionSeconds || time < entry.start) {
        entry = { from: entry ? this.sample(entry, time) : 0, to: target, start: time, duration, setting: harmony.mapping.transitionSeconds };
        this.transitions.set(name, entry);
      }
      result[name] = this.sample(entry, time);
    }
    return result;
  }
}
