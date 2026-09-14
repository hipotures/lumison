/*
 * Worker-safe subset of the pinned MIT-licensed audiojs packages:
 * @audio/loudness-lufs 1.1.0, @audio/loudness-truepeak 1.1.4,
 * @audio/weighting-k 1.1.2, @audio/biquad 1.2.1, and
 * @audio/resample-sinc 1.1.2. Only module wiring was consolidated here;
 * the measurement DSP is unchanged. Import maps do not apply inside workers.
 */

const LUFS_OFFSET = -0.691;
const ABSOLUTE_GATE = -70;
const RELATIVE_GATE = -10;
const GATE_WINDOW_SECONDS = 0.4;
const GATE_HOP_SECONDS = 0.1;
const SINC_HALF_WIDTH = 16;

const CHANNEL_LAYOUTS = Object.freeze({
  1: Object.freeze([1]),
  2: Object.freeze([1, 1]),
  4: Object.freeze([1, 1, 1.41, 1.41]),
  5: Object.freeze([1, 1, 1, 1.41, 1.41]),
  6: Object.freeze([1, 1, 1, 0, 1.41, 1.41]),
});

const biquadState = () => new Float64Array(2);

function biquadStep(coefficients, state, input) {
  const output = coefficients.b0 * input + state[0];
  state[0] = coefficients.b1 * input - coefficients.a1 * output + state[1];
  state[1] = coefficients.b2 * input - coefficients.a2 * output;
  return output;
}

function kWeightingCoefficients(sampleRate = 48_000) {
  const shelfGain = 3.999843853973347;
  const shelfQ = 0.7071752369554196;
  const shelfFrequency = 1681.974450955533;
  const shelfK = Math.tan(Math.PI * shelfFrequency / sampleRate);
  const shelfVh = 10 ** (shelfGain / 20);
  const shelfVb = shelfVh ** 0.4996667741545416;
  const shelfA0 = 1 + shelfK / shelfQ + shelfK * shelfK;
  const shelf = {
    b0: (shelfVh + shelfVb * shelfK / shelfQ + shelfK * shelfK) / shelfA0,
    b1: 2 * (shelfK * shelfK - shelfVh) / shelfA0,
    b2: (shelfVh - shelfVb * shelfK / shelfQ + shelfK * shelfK) / shelfA0,
    a1: 2 * (shelfK * shelfK - 1) / shelfA0,
    a2: (1 - shelfK / shelfQ + shelfK * shelfK) / shelfA0,
  };

  const highpassQ = 0.5003270373238773;
  const highpassFrequency = 38.13547087602444;
  const highpassK = Math.tan(Math.PI * highpassFrequency / sampleRate);
  const highpassA0 = 1 + highpassK / highpassQ + highpassK * highpassK;
  const highpass = {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: 2 * (highpassK * highpassK - 1) / highpassA0,
    a2: (1 - highpassK / highpassQ + highpassK * highpassK) / highpassA0,
  };
  return [shelf, highpass];
}

export function measureIntegratedLufs(channels, { fs = 48_000, weights } = {}) {
  const inputChannels = channels[0]?.length === undefined ? [channels] : channels;
  const channelWeights = weights || CHANNEL_LAYOUTS[inputChannels.length]
    || inputChannels.map(() => 1);
  const hopLength = Math.round(GATE_HOP_SECONDS * fs);
  const hopsPerWindow = Math.round(GATE_WINDOW_SECONDS / GATE_HOP_SECONDS);
  const windowLength = hopLength * hopsPerWindow;
  const sampleCount = inputChannels[0].length;
  if (sampleCount < windowLength) return null;

  const hopCount = Math.floor(sampleCount / hopLength);
  const blocks = new Float64Array(hopCount - hopsPerWindow + 1);
  const power = new Float64Array(hopCount);
  const [shelf, highpass] = kWeightingCoefficients(fs);

  for (let channel = 0; channel < inputChannels.length; channel += 1) {
    if (!channelWeights[channel]) continue;
    const input = inputChannels[channel];
    const shelfState = biquadState();
    const highpassState = biquadState();
    for (let hop = 0, index = 0; hop < hopCount; hop += 1) {
      let sum = 0;
      for (const end = index + hopLength; index < end; index += 1) {
        const weighted = biquadStep(
          highpass,
          highpassState,
          biquadStep(shelf, shelfState, input[index]),
        );
        sum += weighted * weighted;
      }
      power[hop] = sum;
    }
    for (let block = 0; block < blocks.length; block += 1) {
      let sum = 0;
      for (let hop = 0; hop < hopsPerWindow; hop += 1) sum += power[block + hop];
      blocks[block] += channelWeights[channel] * sum / windowLength;
    }
  }

  const absoluteThreshold = 10 ** ((ABSOLUTE_GATE - LUFS_OFFSET) / 10);
  let sum = 0;
  let count = 0;
  for (const powerValue of blocks) {
    if (powerValue > absoluteThreshold) {
      sum += powerValue;
      count += 1;
    }
  }
  if (!count) return null;

  const relativeThreshold = (sum / count) * 10 ** (RELATIVE_GATE / 10);
  sum = 0;
  count = 0;
  for (const powerValue of blocks) {
    if (powerValue > absoluteThreshold && powerValue > relativeThreshold) {
      sum += powerValue;
      count += 1;
    }
  }
  return count ? LUFS_OFFSET + 10 * Math.log10(sum / count) : null;
}

const sinc = (value) => (value === 0 ? 1 : Math.sin(Math.PI * value) / (Math.PI * value));

function resampleSinc(input, { from, to }) {
  if (!(from > 0) || !(to > 0)) {
    throw new RangeError('resample: from/to must be positive sample rates');
  }
  if (from === to) return Float32Array.from(input);
  const rate = from / to;
  const output = new Float32Array(Math.round(input.length * to / from));
  const scale = rate > 1 ? 1 / rate : 1;
  for (let index = 0; index < output.length; index += 1) {
    const position = index * rate;
    const base = Math.floor(position);
    const fraction = position - base;
    let sum = 0;
    let weight = 0;
    for (let tap = 1 - SINC_HALF_WIDTH; tap <= SINC_HALF_WIDTH; tap += 1) {
      const inputIndex = base + tap;
      if (inputIndex < 0 || inputIndex >= input.length) continue;
      const distance = (tap - fraction) * scale;
      const kernel = sinc(distance) * sinc(distance / SINC_HALF_WIDTH);
      sum += input[inputIndex] * kernel;
      weight += kernel;
    }
    output[index] = weight !== 0 ? sum / weight : 0;
  }
  return output;
}

export function measureTruePeak(channels, { fs = 48_000, oversample = 4 } = {}) {
  const inputChannels = channels[0]?.length === undefined ? [channels] : channels;
  let peak = 0;
  for (const channel of inputChannels) {
    for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
    const upsampled = resampleSinc(channel, { from: fs, to: fs * oversample });
    for (const sample of upsampled) peak = Math.max(peak, Math.abs(sample));
  }
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}

export function measureLoudness(channels, sampleRate) {
  return {
    measuredLufs: measureIntegratedLufs(channels, { fs: sampleRate }),
    measuredTruePeakDbTP: measureTruePeak(channels, { fs: sampleRate }),
  };
}
