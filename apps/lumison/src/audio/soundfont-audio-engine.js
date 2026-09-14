import {
  createMidiChannelTimeline,
  rebuildMidiChannelState,
  applyReconstructedMidiState,
} from './midi-channel-state.js';
import {
  dispatchCanonicalMidiEvent,
  MIDI_AUDIO_SCHEDULER_CONFIG,
  MidiAudioScheduler,
} from './midi-audio-scheduler.js';
import { analyzeMidiSoundFont, isAbortError } from './loudness-analyzer.js';
import {
  calculateNormalizationGain,
  effectiveOutputGain,
  LOUDNESS_MODE,
  LOUDNESS_NORMALIZATION,
  LoudnessNormalizationState,
} from './loudness-normalization.js';
import { SPESSASYNTH_WORKLET_URL } from './spessasynth-config.js';

export { SPESSASYNTH_WORKLET_URL } from './spessasynth-config.js';
const SOUND_BANK_LOAD_TIMEOUT_MS = 120_000;
const DRAIN_MARGIN_SECONDS = 0.015;

const defaultContextFactory = () => new AudioContext();
const defaultSynthLoader = () => import('spessasynth_lib');

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function withTimeout(promise, milliseconds, message) {
  let timeout;
  return Promise.race([
    promise.finally(() => clearTimeout(timeout)),
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(message)), milliseconds);
    }),
  ]);
}

export class SoundFontAudioEngine {
  constructor({
    processorUrl = SPESSASYNTH_WORKLET_URL,
    contextFactory = defaultContextFactory,
    synthLoader = defaultSynthLoader,
    getTransport = () => ({ position: 0, rate: 1, playing: false }),
    getPerformance = () => null,
    intervalMs = MIDI_AUDIO_SCHEDULER_CONFIG.intervalMs,
    loudnessAnalyzer = analyzeMidiSoundFont,
  } = {}) {
    this.processorUrl = processorUrl;
    this.contextFactory = contextFactory;
    this.synthLoader = synthLoader;
    this.getTransport = getTransport;
    this.getPerformance = getPerformance;
    this.intervalMs = intervalMs;
    this.loudnessAnalyzer = loudnessAnalyzer;
    this.enabled = true;
    this.sourceActive = true;
    this.volume = 0.8;
    this.status = 'No SoundFont';
    this.error = '';
    this.loading = false;
    this.activeBankId = null;
    this.activeBankName = null;
    this.bankSequence = 0;
    this.events = [];
    this.channelTimeline = createMidiChannelTimeline([]);
    this.context = null;
    this.gain = null;
    this.synth = null;
    this.initializing = null;
    this.interval = null;
    this.operation = 0;
    this.analysisPromise = null;
    this.analysisController = null;
    this.transportPlaying = false;
    this.destroyed = false;
    this.pendingHorizon = 0;
    this.listeners = new Set();
    this.loudness = new LoudnessNormalizationState();
    this.scheduler = new MidiAudioScheduler({
      scheduleEvent: (event, time) => {
        if (this.synth) dispatchCanonicalMidiEvent(this.synth, event, time);
      },
    });
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    for (const listener of this.listeners) listener(this);
  }

  setStatus(status, error = '') {
    this.status = status;
    this.error = error;
    this.notify();
  }

  refreshStatus() {
    if (this.loading) return this.setStatus('Loading...');
    if (!this.activeBankId) return this.setStatus('No SoundFont');
    if (this.context?.state === 'suspended') return this.setStatus('Audio suspended');
    return this.setStatus('Ready');
  }

  setTimeline(events) {
    // Preserve the old queue horizon before replacing the cursor. A later play
    // waits for those un-cancellable worklet messages while output stays muted.
    this.interrupt();
    this.events = Array.isArray(events) ? events : [];
    this.channelTimeline = createMidiChannelTimeline(this.events);
    this.scheduler.setTimeline(this.events);
  }

  setVolume(value) {
    this.volume = Math.max(0, Math.min(1, Number(value) || 0));
    if (this.gain && this.scheduler.active && this.enabled && this.sourceActive) {
      const now = this.context.currentTime;
      this.gain.gain.cancelScheduledValues(now);
      this.gain.gain.setValueAtTime(this.effectiveGain(), now);
    }
    this.notify();
    return this.volume;
  }

  effectiveGain() {
    return effectiveOutputGain(this.volume, this.loudness.mode, this.loudness.result);
  }

  applyNormalizationGain() {
    if (!this.gain || !this.context || !this.scheduler.active
      || !this.enabled || !this.sourceActive) return;
    const now = this.context.currentTime;
    const parameter = this.gain.gain;
    if (typeof parameter.cancelAndHoldAtTime === 'function') parameter.cancelAndHoldAtTime(now);
    else {
      const current = parameter.value;
      parameter.cancelScheduledValues(now);
      parameter.setValueAtTime(current, now);
    }
    parameter.linearRampToValueAtTime(
      this.effectiveGain(),
      now + LOUDNESS_NORMALIZATION.gainRampSeconds,
    );
  }

  setLoudnessMode(mode) {
    this.loudness.setMode(mode);
    if (mode === LOUDNESS_MODE.ORIGINAL || this.isTransportPlaying()) {
      this.cancelNormalizationAnalysis();
    }
    this.applyNormalizationGain();
    this.notify();
    void this.maybeStartNormalizationAnalysis();
    return this.loudness.mode;
  }

  setMidiSource(source) {
    this.cancelNormalizationAnalysis();
    this.loudness.setSources({ midiSource: source });
    this.applyNormalizationGain();
    this.notify();
    void this.maybeStartNormalizationAnalysis();
  }

  async maybeStartNormalizationAnalysis() {
    if (this.destroyed || this.loudness.mode !== LOUDNESS_MODE.NORMALIZE
      || this.loudness.result || !this.loudness.key || this.analysisPromise) return false;
    if (this.isTransportPlaying()) {
      this.loudness.refresh();
      this.notify();
      return false;
    }

    const token = this.loudness.beginAnalysis();
    if (!token) return false;
    const controller = new AbortController();
    this.analysisController = { token, controller };
    this.notify();
    const promise = this.runNormalizationAnalysis(token, controller.signal);
    this.analysisPromise = promise;
    void promise.finally(() => {
      if (this.analysisPromise !== promise) return;
      this.analysisPromise = null;
      if (this.analysisController?.token === token) this.analysisController = null;
      void this.maybeStartNormalizationAnalysis();
    });
    return true;
  }

  isTransportPlaying() {
    return this.transportPlaying || this.getTransport().playing === true;
  }

  cancelNormalizationAnalysis() {
    if (!this.analysisController) return false;
    const { token, controller } = this.analysisController;
    controller.abort();
    const current = this.loudness.cancelAnalysis(token);
    this.notify();
    return current;
  }

  async runNormalizationAnalysis(token, signal) {
    try {
      const [midiBuffer, soundFontBuffer] = await Promise.all([
        token.midiSource.loadBuffer({ signal }),
        token.soundFontSource.loadBuffer({ signal }),
      ]);
      if (signal.aborted) return;
      const measurement = await this.loudnessAnalyzer({
        midiBuffer,
        midiName: token.midiSource.name,
        soundFontBuffer,
        processorUrl: this.processorUrl,
        signal,
        onProgress: (progress) => {
          if (this.loudness.updateProgress(token, progress)) this.notify();
        },
      });
      const result = calculateNormalizationGain(
        measurement.measuredLufs,
        measurement.measuredTruePeakDbTP,
      );
      if (this.loudness.completeAnalysis(token, result)) this.applyNormalizationGain();
    } catch (error) {
      if (isAbortError(error)) {
        this.loudness.cancelAnalysis(token);
      } else {
        console.error('Loudness normalization analysis failed:', error);
        if (this.loudness.failAnalysis(token, error)) this.applyNormalizationGain();
      }
    }
    this.notify();
  }

  async ensureInitialized({ resume = false } = {}) {
    if (!this.context) {
      this.context = this.contextFactory();
      this.gain = this.context.createGain();
      this.gain.gain.value = 0;
      this.gain.connect(this.context.destination);
      const stateChanged = () => this.refreshStatus();
      if (typeof this.context.addEventListener === 'function') {
        this.context.addEventListener('statechange', stateChanged);
      } else {
        this.context.onstatechange = stateChanged;
      }
    }
    const resumePromise = resume && this.context.state !== 'running'
      ? this.context.resume().catch(() => undefined)
      : Promise.resolve();
    if (!this.initializing && !this.synth) {
      this.initializing = (async () => {
        await this.context.audioWorklet.addModule(this.processorUrl);
        const { WorkletSynthesizer } = await this.synthLoader();
        this.synth = new WorkletSynthesizer(this.context);
        this.synth.connect(this.gain);
        await this.synth.isReady;
      })().finally(() => { this.initializing = null; });
    }
    if (this.initializing) await this.initializing;
    await resumePromise;
    return this.synth;
  }

  async activate() {
    try {
      await this.ensureInitialized({ resume: true });
      this.refreshStatus();
      return this.context.state === 'running';
    } catch (error) {
      this.setStatus('Error', error?.message ?? String(error));
      return false;
    }
  }

  mute() {
    if (!this.gain || !this.context) return;
    const now = this.context.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(0, now);
  }

  unmute() {
    if (!this.gain || !this.context) return;
    const now = this.context.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(this.effectiveGain(), now);
  }

  clearInterval() {
    if (this.interval !== null) clearInterval(this.interval);
    this.interval = null;
  }

  startInterval() {
    this.clearInterval();
    this.scheduler.tick(this.context.currentTime);
    this.interval = setInterval(() => {
      this.scheduler.tick(this.context.currentTime);
    }, this.intervalMs);
  }

  async drainScheduledEvents(horizon, operation) {
    while (this.context && this.context.currentTime + DRAIN_MARGIN_SECONDS < horizon) {
      if (operation !== this.operation) return false;
      if (this.context.state !== 'running') return false;
      const remaining = horizon - this.context.currentTime + DRAIN_MARGIN_SECONDS;
      await wait(Math.min(25, Math.max(1, remaining * 1000)));
    }
    return operation === this.operation;
  }

  interrupt({ resetScheduler = false } = {}) {
    const horizon = Math.max(this.pendingHorizon, this.scheduler.lastScheduledAudioTime);
    this.pendingHorizon = horizon;
    this.operation += 1;
    this.clearInterval();
    this.scheduler.pause();
    if (resetScheduler) this.scheduler.stop();
    this.mute();
    this.synth?.stopAll(true);
    return { horizon, operation: this.operation };
  }

  async synchronize({ restartSounding = true } = {}) {
    if (!this.synth || !this.activeBankId) return false;
    const { horizon, operation } = this.interrupt();
    if (!await this.drainScheduledEvents(horizon, operation)) return false;
    if (operation !== this.operation) return false;
    this.pendingHorizon = 0;
    this.synth.stopAll(true);
    const transport = this.getTransport();
    const channelState = rebuildMidiChannelState(this.channelTimeline, transport.position);
    applyReconstructedMidiState(
      this.synth,
      channelState,
      this.getPerformance(),
      this.context.currentTime,
      { restartSounding: restartSounding && transport.playing },
    );

    if (transport.playing && this.enabled && this.sourceActive) {
      this.scheduler.start(transport.position, transport.rate, this.context.currentTime);
      this.unmute();
      this.startInterval();
    }
    this.refreshStatus();
    return true;
  }

  async startPlayback() {
    if (!this.enabled || !this.sourceActive || !this.activeBankId) return false;
    if (!await this.activate()) return false;
    return this.synchronize({ restartSounding: true });
  }

  pause() {
    this.interrupt();
    this.refreshStatus();
  }

  stop() {
    this.interrupt({ resetScheduler: true });
    this.refreshStatus();
  }

  setEnabled(enabled) {
    this.enabled = enabled === true;
    if (!this.enabled) this.stop();
    else if (this.getTransport().playing) void this.startPlayback();
    else this.refreshStatus();
    this.notify();
  }

  setSourceActive(active) {
    this.sourceActive = active === true;
    if (!this.sourceActive) this.stop();
    else if (this.enabled && this.getTransport().playing) void this.startPlayback();
    this.notify();
  }

  async loadSoundFont({ name, sourceKey, loadBuffer }) {
    if (this.loading) return false;
    this.cancelNormalizationAnalysis();
    this.loading = true;
    this.setStatus('Loading...');
    this.interrupt();
    const oldBankId = this.activeBankId;
    try {
      await this.ensureInitialized({ resume: true });
      const buffer = await loadBuffer();
      if (!(buffer instanceof ArrayBuffer)) throw new TypeError('SoundFont loader returned no data');
      const newBankId = `lumison-bank-${++this.bankSequence}`;
      await withTimeout(
        this.synth.soundBankManager.addSoundBank(buffer, newBankId),
        SOUND_BANK_LOAD_TIMEOUT_MS,
        'SoundFont loading timed out',
      );
      const order = this.synth.soundBankManager.priorityOrder;
      this.synth.soundBankManager.priorityOrder = [
        newBankId,
        ...order.filter((id) => id !== newBankId),
      ];
      if (oldBankId && oldBankId !== newBankId) {
        await this.synth.soundBankManager.deleteSoundBank(oldBankId);
      }
      this.activeBankId = newBankId;
      this.activeBankName = name;
      this.loudness.setSources({
        soundFontSource: sourceKey ? { key: sourceKey, name, loadBuffer } : null,
      });
      this.loading = false;
      await this.synchronize({ restartSounding: true });
      this.refreshStatus();
      void this.maybeStartNormalizationAnalysis();
      return true;
    } catch (error) {
      this.loading = false;
      this.setStatus('Error', error?.message ?? String(error));
      return false;
    }
  }

  handleTransport(reason) {
    if (reason === 'play') {
      this.transportPlaying = true;
      this.cancelNormalizationAnalysis();
      void this.startPlayback();
    }
    else if (reason === 'pause' || reason === 'ended') {
      this.transportPlaying = false;
      this.pause();
      void this.maybeStartNormalizationAnalysis();
    } else if (reason === 'stop' || reason === 'load') {
      this.transportPlaying = false;
      this.stop();
      if (reason === 'stop') void this.maybeStartNormalizationAnalysis();
    } else if (reason === 'seek' || reason === 'rate' || reason === 'loop') {
      if (this.getTransport().playing && this.enabled && this.sourceActive) {
        void this.startPlayback();
      } else {
        this.stop();
      }
    }
  }

  destroy() {
    this.destroyed = true;
    this.cancelNormalizationAnalysis();
    this.operation += 1;
    this.clearInterval();
    this.mute();
    this.synth?.stopAll(true);
    this.synth?.destroy();
    this.gain?.disconnect();
    if (this.context?.state !== 'closed') void this.context?.close?.();
    this.synth = null;
    this.context = null;
    this.gain = null;
  }
}
