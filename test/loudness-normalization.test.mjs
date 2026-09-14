import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateNormalizationGain,
  createHostedSourceKey,
  createLocalFileSourceKey,
  createNormalizationCacheKey,
  dbToLinear,
  effectiveOutputGain,
  linearToDb,
  LOUDNESS_MODE,
  LOUDNESS_NORMALIZATION,
  LoudnessNormalizationState,
  selectedNormalizationGainDb,
} from '../apps/lumison/src/audio/loudness-normalization.js';

const closeTo = (actual, expected, tolerance = 1e-10) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ~= ${expected}`);
};

const source = (key) => ({ key, name: `${key}.bin`, loadBuffer: async () => new ArrayBuffer(1) });

test('decibel and linear gain conversions are inverse operations', () => {
  closeTo(dbToLinear(0), 1);
  closeTo(dbToLinear(6), 1.9952623149688795);
  closeTo(linearToDb(0.5), -6.020599913279624);
  closeTo(linearToDb(dbToLinear(-13.25)), -13.25);
  assert.equal(linearToDb(0), -Infinity);
});

test('normalization targets LUFS with one static gain when true peak permits it', () => {
  const result = calculateNormalizationGain(-20, -8);
  assert.equal(result.loudnessGainDb, 4);
  assert.equal(result.peakAllowedGainDb, 7);
  assert.equal(result.normalizationGainDb, 4);
  assert.equal(result.result, 'target');
});

test('true-peak ceiling limits a loudness boost', () => {
  const result = calculateNormalizationGain(-26, -8);
  assert.equal(result.loudnessGainDb, 10);
  assert.equal(result.peakAllowedGainDb, 7);
  assert.equal(result.normalizationGainDb, 7);
  assert.equal(result.result, 'peak-limited');
  assert.equal(result.measuredTruePeakDbTP + result.normalizationGainDb, -1);
});

test('a naturally loud render is attenuated rather than boosted', () => {
  const result = calculateNormalizationGain(-10, -0.5);
  assert.equal(result.normalizationGainDb, -6);
  assert.equal(result.result, 'target');
  assert.equal(result.measuredLufs + result.normalizationGainDb, -16);
  assert.ok(result.measuredTruePeakDbTP + result.normalizationGainDb <= -1);
});

test('normalization gain is bounded to +18 dB boost and -24 dB attenuation', () => {
  const quiet = calculateNormalizationGain(-60, -40);
  assert.equal(quiet.normalizationGainDb, LOUDNESS_NORMALIZATION.maximumGainDb);
  assert.equal(quiet.result, 'gain-limited');

  const loud = calculateNormalizationGain(20, 0);
  assert.equal(loud.normalizationGainDb, LOUDNESS_NORMALIZATION.minimumGainDb);
  assert.equal(loud.result, 'gain-limited');
});

test('silent or non-finite measurements apply no normalization gain', () => {
  for (const [lufs, peak] of [[null, -Infinity], [NaN, -4], [-20, Infinity]]) {
    const result = calculateNormalizationGain(lufs, peak);
    assert.equal(result.normalizable, false);
    assert.equal(result.normalizationGainDb, 0);
    assert.equal(result.result, 'silent');
  }
});

test('Original is 0 dB and user volume remains an independent multiplier', () => {
  const result = calculateNormalizationGain(-22, -12);
  assert.equal(selectedNormalizationGainDb(LOUDNESS_MODE.ORIGINAL, result), 0);
  assert.equal(effectiveOutputGain(0.5, LOUDNESS_MODE.ORIGINAL, result), 0.5);
  closeTo(
    effectiveOutputGain(0.5, LOUDNESS_MODE.NORMALIZE, result),
    0.5 * dbToLinear(6),
  );
  assert.ok(effectiveOutputGain(1, LOUDNESS_MODE.NORMALIZE, result) > 1);
});

test('cache keys include source identities and normalization target version', () => {
  const midi = createLocalFileSourceKey('midi', {
    name: 'piece.mid', size: 1234, lastModified: 5678,
  });
  const bankA = createHostedSourceKey('soundfont', 'piano-a', 'Piano A.sf2');
  const bankB = createHostedSourceKey('soundfont', 'piano-b', 'Piano B.sf2');
  const keyA = createNormalizationCacheKey({
    midiSourceKey: midi, soundFontSourceKey: bankA,
  });
  const keyB = createNormalizationCacheKey({
    midiSourceKey: midi, soundFontSourceKey: bankB,
  });
  assert.notEqual(keyA, keyB);
  assert.notEqual(keyA, createNormalizationCacheKey({
    midiSourceKey: midi, soundFontSourceKey: bankA, version: 'future-target-v2',
  }));
});

test('a stale analysis result cannot replace the current source selection', () => {
  const state = new LoudnessNormalizationState();
  state.setMode(LOUDNESS_MODE.NORMALIZE);
  state.setSources({ midiSource: source('midi-a'), soundFontSource: source('bank-a') });
  const staleToken = state.beginAnalysis();
  state.setSources({ midiSource: source('midi-b') });
  const staleResult = calculateNormalizationGain(-25, -10);

  assert.equal(state.completeAnalysis(staleToken, staleResult), false);
  assert.equal(state.result, null);
  assert.equal(state.status, 'pending');
  assert.equal(state.cache.get(staleToken.key), staleResult);

  state.setSources({ midiSource: source('midi-a') });
  assert.equal(state.result, staleResult);
  assert.equal(state.status, 'ready');
});

test('switching Original and Normalize reuses a cached result immediately', () => {
  const state = new LoudnessNormalizationState();
  state.setSources({ midiSource: source('midi'), soundFontSource: source('bank') });
  state.setMode(LOUDNESS_MODE.NORMALIZE);
  const token = state.beginAnalysis();
  const result = calculateNormalizationGain(-21, -9);
  assert.equal(state.completeAnalysis(token, result), true);
  assert.equal(state.status, 'ready');

  assert.equal(state.setMode(LOUDNESS_MODE.ORIGINAL), 0);
  assert.equal(state.status, 'original');
  assert.equal(state.setMode(LOUDNESS_MODE.NORMALIZE), 5);
  assert.equal(state.status, 'ready');
  assert.equal(state.result, result);
  assert.equal(state.cache.size, 1);
});

test('MIDI playback rate is deliberately absent from normalization cache selection', () => {
  const identity = {
    midiSourceKey: 'midi',
    soundFontSourceKey: 'bank',
  };
  const slow = createNormalizationCacheKey({ ...identity, playbackRate: 0.25 });
  const fast = createNormalizationCacheKey({ ...identity, playbackRate: 2 });
  assert.equal(slow, fast);
});

test('analysis failure stays isolated and falls back to original gain', () => {
  const state = new LoudnessNormalizationState();
  state.setSources({ midiSource: source('midi'), soundFontSource: source('bank') });
  state.setMode(LOUDNESS_MODE.NORMALIZE);
  const token = state.beginAnalysis();

  assert.equal(state.failAnalysis(token, new Error('offline render failed')), true);
  assert.equal(state.status, 'error');
  assert.equal(state.error, 'offline render failed');
  assert.equal(state.result, null);
  assert.equal(selectedNormalizationGainDb(state.mode, state.result), 0);
});
