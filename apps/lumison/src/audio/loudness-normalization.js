export const LOUDNESS_MODE = Object.freeze({
  ORIGINAL: 'original',
  NORMALIZE: 'normalize',
});

export const LOUDNESS_NORMALIZATION = Object.freeze({
  targetLufs: -16,
  truePeakCeilingDbTP: -1,
  minimumGainDb: -24,
  maximumGainDb: 18,
  gainRampSeconds: 0.035,
  cacheVersion: 'bs1770-4_-16lufs_-1dbtp_static-v1',
});

const finiteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

export function dbToLinear(decibels) {
  return 10 ** (Number(decibels) / 20);
}

export function linearToDb(linear) {
  const value = Number(linear);
  return value > 0 ? 20 * Math.log10(value) : -Infinity;
}

export function calculateNormalizationGain(measuredLufs, measuredTruePeakDbTP) {
  if (!finiteNumber(measuredLufs) || !finiteNumber(measuredTruePeakDbTP)) {
    return Object.freeze({
      normalizable: false,
      measuredLufs: finiteNumber(measuredLufs) ? measuredLufs : null,
      measuredTruePeakDbTP: finiteNumber(measuredTruePeakDbTP)
        ? measuredTruePeakDbTP : null,
      loudnessGainDb: 0,
      peakAllowedGainDb: 0,
      normalizationGainDb: 0,
      result: 'silent',
    });
  }

  const loudnessGainDb = LOUDNESS_NORMALIZATION.targetLufs - measuredLufs;
  const peakAllowedGainDb = LOUDNESS_NORMALIZATION.truePeakCeilingDbTP
    - measuredTruePeakDbTP;
  const unconstrainedGainDb = Math.min(loudnessGainDb, peakAllowedGainDb);
  const normalizationGainDb = Math.max(
    LOUDNESS_NORMALIZATION.minimumGainDb,
    Math.min(LOUDNESS_NORMALIZATION.maximumGainDb, unconstrainedGainDb),
  );
  let result = 'target';
  if (normalizationGainDb !== unconstrainedGainDb) result = 'gain-limited';
  else if (peakAllowedGainDb < loudnessGainDb) result = 'peak-limited';

  return Object.freeze({
    normalizable: true,
    measuredLufs,
    measuredTruePeakDbTP,
    loudnessGainDb,
    peakAllowedGainDb,
    normalizationGainDb,
    result,
  });
}

export function selectedNormalizationGainDb(mode, result) {
  return mode === LOUDNESS_MODE.NORMALIZE && result?.normalizable
    ? result.normalizationGainDb : 0;
}

export function effectiveOutputGain(volume, mode, result) {
  const userVolume = Math.max(0, Math.min(1, Number(volume) || 0));
  return userVolume * dbToLinear(selectedNormalizationGainDb(mode, result));
}

export function createNormalizationCacheKey({
  midiSourceKey,
  soundFontSourceKey,
  version = LOUDNESS_NORMALIZATION.cacheVersion,
}) {
  if (!midiSourceKey || !soundFontSourceKey) return null;
  return JSON.stringify([version, String(midiSourceKey), String(soundFontSourceKey)]);
}

export function createLocalFileSourceKey(kind, file) {
  if (!file || typeof file.name !== 'string') throw new TypeError('Invalid local file');
  return JSON.stringify([
    String(kind),
    'local',
    file.name,
    Number(file.size) || 0,
    Number(file.lastModified) || 0,
  ]);
}

export function createHostedSourceKey(kind, id, path = '') {
  if (!id) throw new TypeError('Hosted source id is required');
  return JSON.stringify([String(kind), 'hosted', String(id), String(path)]);
}

function validateMode(mode) {
  if (!Object.values(LOUDNESS_MODE).includes(mode)) {
    throw new TypeError(`Unknown loudness mode: ${String(mode)}`);
  }
}

function validateSource(source) {
  if (source === null) return;
  if (!source || !source.key || typeof source.loadBuffer !== 'function') {
    throw new TypeError('Normalization sources require a key and loadBuffer function');
  }
}

export class LoudnessNormalizationState {
  constructor({ cache = new Map() } = {}) {
    this.cache = cache;
    this.mode = LOUDNESS_MODE.ORIGINAL;
    this.midiSource = null;
    this.soundFontSource = null;
    this.key = null;
    this.result = null;
    this.status = 'original';
    this.error = '';
    this.progress = 0;
    this.generation = 0;
    this.activeAnalysis = null;
    this.failure = null;
  }

  setMode(mode) {
    validateMode(mode);
    this.mode = mode;
    this.refresh();
    return selectedNormalizationGainDb(this.mode, this.result);
  }

  setSources({ midiSource = this.midiSource, soundFontSource = this.soundFontSource } = {}) {
    validateSource(midiSource);
    validateSource(soundFontSource);
    const previousKey = this.key;
    this.midiSource = midiSource;
    this.soundFontSource = soundFontSource;
    this.key = createNormalizationCacheKey({
      midiSourceKey: midiSource?.key,
      soundFontSourceKey: soundFontSource?.key,
    });
    if (this.key !== previousKey) {
      this.generation += 1;
      this.progress = 0;
      this.failure = null;
    }
    this.refresh();
    return this.result;
  }

  refresh() {
    this.result = this.key ? this.cache.get(this.key) ?? null : null;
    this.error = '';
    if (this.mode === LOUDNESS_MODE.ORIGINAL) this.status = 'original';
    else if (!this.key) this.status = 'unavailable';
    else if (this.result) this.status = this.result.normalizable ? 'ready' : 'silent';
    else if (this.failure?.generation === this.generation && this.failure.key === this.key) {
      this.status = 'error';
      this.error = this.failure.error;
    } else if (this.activeAnalysis?.generation === this.generation
      && this.activeAnalysis.key === this.key) this.status = 'analyzing';
    else this.status = 'pending';
  }

  beginAnalysis() {
    if (this.mode !== LOUDNESS_MODE.NORMALIZE || !this.key || this.result
      || this.activeAnalysis || this.status === 'error') return null;
    const token = Object.freeze({
      generation: this.generation,
      key: this.key,
      midiSource: this.midiSource,
      soundFontSource: this.soundFontSource,
    });
    this.activeAnalysis = token;
    this.progress = 0;
    this.status = 'analyzing';
    return token;
  }

  updateProgress(token, progress) {
    if (token !== this.activeAnalysis) return false;
    this.progress = Math.max(0, Math.min(1, Number(progress) || 0));
    return token.generation === this.generation && token.key === this.key;
  }

  completeAnalysis(token, result) {
    if (token !== this.activeAnalysis) return false;
    this.activeAnalysis = null;
    this.cache.set(token.key, result);
    const current = token.generation === this.generation && token.key === this.key;
    this.refresh();
    return current;
  }

  failAnalysis(token, error) {
    if (token !== this.activeAnalysis) return false;
    this.activeAnalysis = null;
    const current = token.generation === this.generation && token.key === this.key;
    if (current) {
      this.failure = {
        generation: token.generation,
        key: token.key,
        error: error?.message ?? String(error),
      };
    }
    this.refresh();
    return current;
  }
}
