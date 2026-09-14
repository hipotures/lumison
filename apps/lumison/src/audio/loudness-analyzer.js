import measureLufs from '@audio/loudness-lufs';
import measureTruePeak from '@audio/loudness-truepeak';
import { SPESSASYNTH_WORKLET_URL } from './spessasynth-config.js';

export const LOUDNESS_ANALYSIS_SAMPLE_RATE = 44_100;
export const LOUDNESS_ANALYSIS_TAIL_SECONDS = 3;

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
  onProgress = () => {},
}) {
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

  try {
    await context.audioWorklet.addModule(processorUrl);
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

    onProgress(0);
    progressTimer = setInterval(() => {
      onProgress(Math.min(0.98, context.currentTime / Math.max(renderDuration, 0.001)));
    }, 100);
    const rendered = await context.startRendering();
    clearInterval(progressTimer);
    progressTimer = null;
    onProgress(0.99);

    const channels = Array.from(
      { length: rendered.numberOfChannels },
      (_, channel) => rendered.getChannelData(channel),
    );
    const measuredLufs = measureLufs(channels, { fs: rendered.sampleRate });
    const measuredTruePeakDbTP = measureTruePeak(channels, { fs: rendered.sampleRate });
    onProgress(1);
    return { measuredLufs, measuredTruePeakDbTP };
  } finally {
    if (progressTimer !== null) clearInterval(progressTimer);
    try { synth?.destroy(); } catch {}
    try { await context.close?.(); } catch {}
  }
}
