import assert from 'node:assert/strict';
import test from 'node:test';
import referenceLufs from '@audio/loudness-lufs';
import referenceTruePeak from '@audio/loudness-truepeak';
import {
  analyzeMidiSoundFont,
  measureLoudnessInWorker,
} from '../apps/lumison/src/audio/loudness-analyzer.js';
import {
  measureIntegratedLufs,
  measureTruePeak,
} from '../apps/lumison/src/audio/loudness-meter-core.js';

test('offline analyzer configures SpessaSynth before rendering without browser globals', async () => {
  const calls = [];
  const midiBuffer = new ArrayBuffer(4);
  const soundFontBuffer = new ArrayBuffer(8);
  const channelData = [new Float32Array(300), new Float32Array(300)];
  const context = {
    currentTime: 0,
    destination: {},
    audioWorklet: {
      addModule: async (url) => { calls.push(['addModule', url]); },
    },
    startRendering: async () => {
      calls.push(['startRendering']);
      return {
        numberOfChannels: 2,
        sampleRate: 100,
        getChannelData: (channel) => channelData[channel],
      };
    },
    close: async () => { calls.push(['close']); },
  };
  class FakeSynth {
    constructor(receivedContext) {
      assert.equal(receivedContext, context);
      calls.push(['construct']);
    }

    connect(destination) {
      assert.equal(destination, context.destination);
      calls.push(['connect']);
    }

    async startOfflineRender(config) {
      assert.equal(config.midiSequence.duration, 0);
      assert.equal(config.loopCount, 0);
      assert.equal(config.soundBankList[0].soundBankBuffer, soundFontBuffer);
      assert.deepEqual(config.sequencerOptions, {
        skipToFirstNoteOn: false,
        initialPlaybackRate: 1,
      });
      calls.push(['startOfflineRender']);
    }

    destroy() { calls.push(['destroy']); }
  }

  const progress = [];
  const result = await analyzeMidiSoundFont({
    midiBuffer,
    midiName: 'original.mid',
    soundFontBuffer,
    processorUrl: '/processor.js',
    sampleRate: 100,
    contextFactory: (options) => {
      assert.deepEqual(options, { channels: 2, length: 300, sampleRate: 100 });
      return context;
    },
    spessaLoader: async () => ({
      WorkletSynthesizer: FakeSynth,
      BasicMIDI: {
        fromArrayBuffer: (buffer, name) => {
          assert.equal(buffer, midiBuffer);
          assert.equal(name, 'original.mid');
          return { duration: 0 };
        },
      },
    }),
    measureLoudness: async ({ channels, sampleRate }) => {
      assert.equal(channels[0], channelData[0]);
      assert.equal(channels[1], channelData[1]);
      assert.equal(sampleRate, 100);
      calls.push(['measureLoudness']);
      return { measuredLufs: null, measuredTruePeakDbTP: -Infinity };
    },
    onProgress: (value) => progress.push(value),
  });

  assert.deepEqual(calls, [
    ['addModule', '/processor.js'],
    ['construct'],
    ['connect'],
    ['startOfflineRender'],
    ['startRendering'],
    ['measureLoudness'],
    ['destroy'],
    ['close'],
  ]);
  assert.equal(result.measuredLufs, null);
  assert.equal(result.measuredTruePeakDbTP, -Infinity);
  assert.deepEqual(progress, [0, 0.99, 1]);
});

test('worker meter transfers rendered channels and terminates after returning a result', async () => {
  const channels = [new Float32Array([0, 0.25]), new Float32Array([0, -0.5])];
  let worker;
  const result = await measureLoudnessInWorker({
    channels,
    sampleRate: 44_100,
    workerFactory: (url, options) => {
      assert.match(String(url), /loudness-meter-worker\.js$/);
      assert.deepEqual(options, { type: 'module' });
      worker = {
        terminated: false,
        postMessage(message, transfer) {
          assert.equal(message.channels, channels);
          assert.equal(message.sampleRate, 44_100);
          assert.deepEqual(transfer, channels.map((channel) => channel.buffer));
          queueMicrotask(() => this.onmessage({
            data: { type: 'result', measuredLufs: -20, measuredTruePeakDbTP: -3 },
          }));
        },
        terminate() { this.terminated = true; },
      };
      return worker;
    },
  });

  assert.deepEqual(result, { measuredLufs: -20, measuredTruePeakDbTP: -3 });
  assert.equal(worker.terminated, true);
});

test('worker meter terminates immediately when analysis is cancelled', async () => {
  const controller = new AbortController();
  let terminated = false;
  const measurement = measureLoudnessInWorker({
    channels: [new Float32Array(1), new Float32Array(1)],
    sampleRate: 44_100,
    signal: controller.signal,
    workerFactory: () => ({
      postMessage() {},
      terminate() { terminated = true; },
    }),
  });
  controller.abort();
  await assert.rejects(measurement, { name: 'AbortError' });
  assert.equal(terminated, true);
});

test('worker-safe meter core matches the pinned audiojs packages', () => {
  const sampleRate = 44_100;
  const length = Math.ceil(sampleRate * 0.45);
  const channels = [new Float32Array(length), new Float32Array(length)];
  for (let index = 0; index < length; index += 1) {
    channels[0][index] = 0.2 * Math.sin(2 * Math.PI * 440 * index / sampleRate);
    channels[1][index] = 0.1 * Math.sin(2 * Math.PI * 659.25 * index / sampleRate);
  }

  assert.equal(
    measureIntegratedLufs(channels, { fs: sampleRate }),
    referenceLufs(channels, { fs: sampleRate }),
  );
  assert.equal(
    measureTruePeak(channels, { fs: sampleRate }),
    referenceTruePeak(channels, { fs: sampleRate }),
  );
});
