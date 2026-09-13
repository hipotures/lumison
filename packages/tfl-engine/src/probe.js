import { sampleFieldApprox } from './film.js';

let lastProbe = 0;

// Fixed-compatible approximate CPU sample. The caller supplies interaction
// coordinates; this module has no knowledge of pointer events or UI.
export function sampleSurface(interaction, params, time, minInterval = 70) {
  if (!interaction?.active) return null;
  const now = performance.now();
  if (now - lastProbe < minInterval) return 'throttled';
  lastProbe = now;
  try {
    const sample = sampleFieldApprox(interaction.x, interaction.y, params, time, {
      x: interaction.x,
      y: interaction.y,
      strength: interaction.strength,
    });
    return {
      ...sample,
      u: interaction.x,
      v: interaction.y,
      px: interaction.hoverX,
      py: interaction.hoverY,
    };
  } catch (error) {
    console.warn('Surface probe failed:', error);
    return {
      error: error?.message ?? String(error),
      px: interaction.hoverX,
      py: interaction.hoverY,
    };
  }
}
