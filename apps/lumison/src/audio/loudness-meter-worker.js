import { measureIntegratedLufs, measureTruePeak } from './loudness-meter-core.js';

self.onmessage = ({ data }) => {
  try {
    const measuredLufs = measureIntegratedLufs(data.channels, { fs: data.sampleRate });
    self.postMessage({ type: 'progress', progress: 0.5 });
    const measuredTruePeakDbTP = measureTruePeak(data.channels, { fs: data.sampleRate });
    self.postMessage({ type: 'result', measuredLufs, measuredTruePeakDbTP });
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error?.message ?? String(error),
    });
  }
};
