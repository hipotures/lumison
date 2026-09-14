import { SPESSASYNTH_WORKLET_URL } from './spessasynth-config.js';

export const LOUDNESS_ANALYSIS_SAMPLE_RATE = 44_100;
export const LOUDNESS_ANALYSIS_TAIL_SECONDS = 3;
export const LOUDNESS_METER_WORKER_URL = new URL('./loudness-meter-worker.js', import.meta.url);

export function createAbortError() {
  const error = new Error('Loudness analysis cancelled');
  error.name = 'AbortError';
  return error;
}

export function isAbortError(error) {
  return error?.name === 'AbortError';
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw createAbortError();
}

export function measureLoudnessInWorker({
  channels,
  sampleRate,
  signal,
  workerFactory = (url, options) => new Worker(url, options),
  workerUrl = LOUDNESS_METER_WORKER_URL,
  onProgress = () => {},
}) {
  throwIfAborted(signal);
  const worker = workerFactory(workerUrl, { type: 'module' });
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      worker.terminate();
      callback(value);
    };
    const abort = () => finish(reject, createAbortError());
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }) => {
      if (data?.type === 'progress') {
        onProgress(data.progress);
      } else if (data?.type === 'result') {
        finish(resolve, {
          measuredLufs: data.measuredLufs,
          measuredTruePeakDbTP: data.measuredTruePeakDbTP,
        });
      } else if (data?.type === 'error') {
        finish(reject, new Error(data.message || 'Loudness measurement failed'));
      }
    };
    worker.onerror = (event) => {
      event.preventDefault?.();
      finish(reject, new Error(event.message || 'Loudness measurement worker failed'));
    };
    worker.onmessageerror = () => {
      finish(reject, new Error('Loudness measurement worker returned invalid data'));
    };

    try {
      const transfer = channels.map((channel) => channel.buffer);
      worker.postMessage({ channels, sampleRate }, transfer);
    } catch (error) {
      finish(reject, error);
    }
  });
}

const defaultContextFactory = ({ channels, length, sampleRate }) => new OfflineAudioContext(
  channels,
  length,
  sampleRate,
);

const defaultSpessaLoader = async () => {
  const [{ WorkletSynthesizer }, { BasicMIDI }] = await Promise.all([
    import('spessasynth_lib'),
    import('spessasynth_core'),
  ]);
  return { WorkletSynthesizer, BasicMIDI };
};

export async function analyzeMidiSoundFont({
  midiBuffer,
  midiName = 'Untitled.mid',
  soundFontBuffer,
  processorUrl = SPESSASYNTH_WORKLET_URL,
  sampleRate = LOUDNESS_ANALYSIS_SAMPLE_RATE,
  tailSeconds = LOUDNESS_ANALYSIS_TAIL_SECONDS,
  contextFactory = defaultContextFactory,
  spessaLoader = defaultSpessaLoader,
  measureLoudness = measureLoudnessInWorker,
  signal,
  onProgress = () => {},
  onPhase = () => {},
}) {
  throwIfAborted(signal);
  if (!(midiBuffer instanceof ArrayBuffer)) throw new TypeError('MIDI source returned no data');
  if (!(soundFontBuffer instanceof ArrayBuffer)) {
    throw new TypeError('SoundFont source returned no data');
  }

  const { WorkletSynthesizer, BasicMIDI } = await spessaLoader();
  const midiSequence = BasicMIDI.fromArrayBuffer(midiBuffer, midiName);
  const midiDuration = Number(midiSequence.duration);
  if (!(midiDuration >= 0 && Number.isFinite(midiDuration))) {
    throw new Error('SoundFont renderer reported an invalid MIDI duration');
  }
  const renderDuration = midiDuration + tailSeconds;
  const context = contextFactory({
    channels: 2,
    length: Math.max(1, Math.ceil(renderDuration * sampleRate)),
    sampleRate,
  });
  let synth = null;
  let progressTimer = null;
  const stopOfflineSynth = () => {
    try { synth?.destroy(); } catch {}
    synth = null;
  };

  try {
    onPhase('rendering');
    signal?.addEventListener('abort', stopOfflineSynth, { once: true });
    await context.audioWorklet.addModule(processorUrl);
    throwIfAborted(signal);
    synth = new WorkletSynthesizer(context);
    synth.connect(context.destination);

    // SpessaSynth requires this message immediately after worklet setup and
    // before OfflineAudioContext.startRendering(), particularly in Chromium.
    await synth.startOfflineRender({
      midiSequence,
      loopCount: 0,
      soundBankList: [{ bankOffset: 0, soundBankBuffer: soundFontBuffer }],
      sequencerOptions: { skipToFirstNoteOn: false, initialPlaybackRate: 1 },
    });
    throwIfAborted(signal);

    onProgress(0);
    progressTimer = setInterval(() => {
      onProgress(Math.min(0.98, context.currentTime / Math.max(renderDuration, 0.001)));
    }, 100);
    const rendered = await context.startRendering();
    clearInterval(progressTimer);
    progressTimer = null;
    throwIfAborted(signal);
    onProgress(0.99);

    const channels = Array.from(
      { length: rendered.numberOfChannels },
      (_, channel) => rendered.getChannelData(channel),
    );
    // Rendering is complete. Release the offline synth before declaring that
    // only worker-side metering remains; this phase may safely finish during Play.
    stopOfflineSynth();
    onPhase('metering');
    const measurement = await measureLoudness({
      channels,
      sampleRate: rendered.sampleRate,
      signal,
      onProgress: (progress) => onProgress(0.99 + 0.01 * progress),
    });
    throwIfAborted(signal);
    onProgress(1);
    return measurement;
  } finally {
    if (progressTimer !== null) clearInterval(progressTimer);
    signal?.removeEventListener('abort', stopOfflineSynth);
    stopOfflineSynth();
    try { await context.close?.(); } catch {}
  }
}
