export const DEFAULT_VISUAL_SEED = 0;
export const DEFAULT_MUTATION_SEED = 0x6d2b79f5;

export function normalizeSeed(seed, fallback = 0) {
  return Number.isSafeInteger(seed) ? seed >>> 0 : fallback >>> 0;
}

// Counter-based mixing makes a sequence fully reconstructible from seed and
// index. It does not rely on Math.random or wall-clock state.
export function randomAt(seed, sequence) {
  let value = (normalizeSeed(seed) + Math.imul(normalizeSeed(sequence), 0x9e3779b9)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x21f0aaad);
  value ^= value >>> 15;
  value = Math.imul(value, 0x735a2d97);
  value ^= value >>> 15;
  return (value >>> 0) / 0x100000000;
}

export function nextStateRandom(state) {
  const sequence = state.sequences.mutation++;
  return randomAt(state.seeds.mutation, sequence);
}
