import { sampleFieldApprox } from './film.js';

// Fixed-compatible approximate CPU sample. Throttling and tooltip placement
// are application policy; this pure sampler has no wall-clock or DOM access.
export function sampleSurface(interaction, params, time) {
  if (!interaction?.active) return null;
  try {
    const sample = sampleFieldApprox(interaction.x, interaction.y, params, time);
    return {
      ...sample,
      u: interaction.x,
      v: interaction.y,
    };
  } catch (error) {
    console.warn('Surface probe failed:', error);
    return {
      error: error?.message ?? String(error),
    };
  }
}
