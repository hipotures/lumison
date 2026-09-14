import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeMidiSoundFont } from '../apps/lumison/src/audio/loudness-analyzer.js';

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
    onProgress: (value) => progress.push(value),
  });

  assert.deepEqual(calls, [
    ['addModule', '/processor.js'],
    ['construct'],
    ['connect'],
    ['startOfflineRender'],
    ['startRendering'],
    ['destroy'],
    ['close'],
  ]);
  assert.equal(result.measuredLufs, null);
  assert.equal(result.measuredTruePeakDbTP, -Infinity);
  assert.deepEqual(progress, [0, 0.99, 1]);
});
