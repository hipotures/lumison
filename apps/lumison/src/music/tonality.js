import { createPerformanceState, reducePerformanceState } from '../midi/performance-state.js';

// Krumhansl–Kessler probe-tone profiles; K-S Pearson key finding:
// https://extra.humdrum.org/man/keycor/ (Krumhansl 1990, pp. 81–96).
export const TONAL_PROFILES = Object.freeze({
  major: Object.freeze([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]),
  minor: Object.freeze([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]),
});
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const modulo = (value, modulus) => ((value % modulus) + modulus) % modulus;
const names = ['C', 'D-flat', 'D', 'E-flat', 'E', 'F', 'F-sharp', 'G', 'A-flat', 'A', 'B-flat', 'B'];
export const keyName = (key) => key ? `${names[key.tonicPitchClass]} ${key.mode}` : 'unknown';
export function fifthsCoordinates(tonicPitchClass) {
  const position = modulo(tonicPitchClass * 7, 12);
  const angle = position * Math.PI / 6;
  return { position, x: Math.cos(angle), y: Math.sin(angle) };
}
export function fifthsDistance(a, b) {
  const distance = Math.abs(fifthsCoordinates(a).position - fifthsCoordinates(b).position);
  return Math.min(distance, 12 - distance);
}
export function keySignature(fifths, minor, timestamp = 0) {
  if (!Number.isInteger(fifths) || fifths < -7 || fifths > 7 || ![0, 1].includes(minor)) return null;
  return { timestamp, fifths, tonicPitchClass: modulo(fifths * 7 + (minor ? 9 : 0), 12), mode: minor ? 'minor' : 'major' };
}
const identity = (key) => key ? `${key.tonicPitchClass}:${key.mode}` : 'unknown';
function correlation(a, b) {
  const meanA = a.reduce((sum, value) => sum + value, 0) / 12;
  const meanB = b.reduce((sum, value) => sum + value, 0) / 12;
  let covariance = 0; let varianceA = 0; let varianceB = 0;
  for (let i = 0; i < 12; i++) {
    const x = a[i] - meanA; const y = b[i] - meanB;
    covariance += x * y; varianceA += x * x; varianceB += y * y;
  }
  return varianceA * varianceB > 1e-16 ? covariance / Math.sqrt(varianceA * varianceB) : 0;
}
export function inferKey(histogram) {
  if (!Array.isArray(histogram) || histogram.length !== 12 || histogram.some((v) => !Number.isFinite(v) || v < 0)) throw new TypeError('Expected 12 finite nonnegative pitch-class durations');
  const total = histogram.reduce((sum, value) => sum + value, 0);
  const scores = [];
  for (const [mode, profile] of Object.entries(TONAL_PROFILES)) {
    for (let tonicPitchClass = 0; tonicPitchClass < 12; tonicPitchClass++) {
      const rotated = profile.map((_, pc) => profile[modulo(pc - tonicPitchClass, 12)]);
      const score = correlation(histogram, rotated);
      scores.push({ tonicPitchClass, mode, score, confidence: clamp01(score) });
    }
  }
  scores.sort((a, b) => b.score - a.score || a.tonicPitchClass - b.tonicPitchClass || a.mode.localeCompare(b.mode));
  const separation = clamp01((scores[0].score - scores[1].score) / 2);
  // Evidence gates are separate from the established profile/correlation method.
  // A lone note/chord or near-tied profile fit is not a reliable local key.
  const sufficient = total >= 2 && histogram.filter((v) => v > total * 0.01).length >= 4
    && scores[0].score > 0 && separation >= 0.01;
  return { key: sufficient ? scores[0] : null, confidence: sufficient ? scores[0].confidence : 0, separation, scores };
}

function upperBound(values, time) {
  let low = 0; let high = values.length;
  while (low < high) { const mid = (low + high) >>> 1; if (values[mid] <= time) low = mid + 1; else high = mid; }
  return low;
}

/** Prefix-integrated sounding chroma. Uses existing pedal/voice semantics, never
 * mutates the player's PerformanceState. Concurrent unisons/octaves are capped
 * per pitch class; reattacks add no artificial attack-count bonus. */
export class TonalityTimeline {
  constructor(events = [], signatures = [], duration = 0) {
    duration = Math.max(duration, events.at(-1)?.timestamp ?? 0);
    events = events.filter((event) => event.channel !== 10);
    this.signatures = signatures.map((value) => keySignature(value.fifths, value.minor, value.timestamp))
      .filter(Boolean).sort((a, b) => a.timestamp - b.timestamp);
    this.times = []; this.integrals = []; this.weights = [];
    const state = createPerformanceState();
    let time = 0; let integral = Array(12).fill(0); let weights = Array(12).fill(0);
    let index = 0;
    while (index < events.length) {
      const nextTime = events[index].timestamp;
      integral = integral.map((value, pc) => value + weights[pc] * (nextTime - time));
      time = nextTime;
      while (index < events.length && events[index].timestamp === time) {
        const event = events[index++];
        if (event.channel !== 10) reducePerformanceState(state, event);
      }
      weights = Array(12).fill(0);
      for (const note of state.soundingNotes.values()) {
        for (const voice of note.voices) weights[voice.note % 12] = Math.max(weights[voice.note % 12], 0.75 + 0.25 * clamp01(voice.velocity));
      }
      this.times.push(time); this.integrals.push(integral); this.weights.push(weights);
    }
    this.duration = Math.max(duration, time);
  }
  integralAt(position) {
    const time = Math.max(0, Math.min(this.duration, position));
    const index = upperBound(this.times, time) - 1;
    if (index < 0) return Array(12).fill(0);
    return this.integrals[index].map((value, pc) => value + this.weights[index][pc] * (time - this.times[index]));
  }
  histogram(position, windowSeconds) {
    const end = this.integralAt(position); const start = this.integralAt(Math.max(0, position - windowSeconds));
    return end.map((value, pc) => Math.max(0, value - start[pc]));
  }
  metadataAt(position) {
    let result = null;
    for (const signature of this.signatures) { if (signature.timestamp > position) break; result = signature; }
    return result;
  }
}

export class TonalityAnalyzer {
  constructor(configuration, timeline = new TonalityTimeline()) {
    this.configuration = { ...configuration }; this.timeline = timeline; this.reset();
  }
  reset() {
    this.nextTick = 0; this.active = null; this.pending = null; this.pendingSince = 0;
    this.snapshot = { key: null, confidence: 0, source: 'unknown', inferred: null, metadata: null, candidate: null, candidateConfidence: 0, stableFor: 0, separation: 0 };
  }
  setTimeline(timeline, position = 0) { this.timeline = timeline; return this.seek(position); }
  configure(configuration, position = 0) {
    if (JSON.stringify(this.configuration) !== JSON.stringify(configuration)) {
      this.configuration = { ...configuration }; this.seek(position);
    }
  }
  seek(position) { this.reset(); return this.update(position); }
  update(position) {
    if (!this.configuration.enabled) { this.reset(); return this.snapshot; }
    if (position < this.nextTick - 0.25) this.reset();
    // Fixed analysis grid makes key decisions independent of render frame rate.
    while (this.nextTick <= position) {
      this.sample(this.nextTick); this.nextTick += 0.25;
    }
    return this.snapshot;
  }
  sample(time) {
    const config = this.configuration;
    const inference = inferKey(this.timeline.histogram(time, config.windowSeconds));
    const metadata = this.timeline.metadataAt(time);
    let candidate = inference.key;
    let source = candidate ? 'inferred' : 'unknown';
    const metadataScore = metadata && inference.scores.find((key) => identity(key) === identity(metadata));
    // Metadata gets a bounded correlation preference, never an unconditional key.
    if (candidate && metadataScore && metadataScore.score + config.metadataPreference >= candidate.score) {
      candidate = metadataScore; source = 'MIDI metadata';
    }
    const adjustedScore = (key) => (inference.scores.find((score) => identity(score) === identity(key))?.score ?? -1)
      + (metadata && identity(metadata) === identity(key) ? config.metadataPreference : 0);
    const confident = candidate && candidate.confidence >= config.minimumConfidence;
    const decisive = confident && (!this.active || identity(candidate) === identity(this.active)
      || adjustedScore(candidate) - adjustedScore(this.active) >= config.switchMargin);
    const proposed = decisive ? candidate : (!confident && !config.holdLastKey ? null : this.active);
    const proposedId = identity(proposed);
    if (this.pending !== proposedId) { this.pending = proposedId; this.pendingSince = time; }
    const stableFor = time - this.pendingSince;
    if (identity(this.active) !== proposedId && stableFor >= config.minimumStableSeconds) this.active = proposed;
    const current = this.active && inference.scores.find((key) => identity(key) === identity(this.active));
    const currentSource = this.active && identity(this.active) === identity(candidate) ? source
      : (this.active ? 'held' : 'unknown');
    this.snapshot = {
      key: this.active && { tonicPitchClass: this.active.tonicPitchClass, mode: this.active.mode },
      confidence: current?.confidence ?? 0, source: currentSource,
      inferred: inference.key, metadata, candidate, candidateConfidence: candidate?.confidence ?? 0,
      stableFor: proposedId === identity(candidate) ? stableFor : 0, separation: inference.separation,
    };
  }
}
