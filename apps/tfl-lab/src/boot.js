// Minimal bootstrap without a Three.js import. A module/dependency load failure
// still produces Fixed's explicitly labelled Canvas2D fallback.
const bootMsg = (text) => {
  const message = document.getElementById('bootMsg');
  if (message) message.textContent = text;
};

try {
  await import('./main.js');
} catch (error) {
  console.error('main module failed:', error);
  bootMsg('Three.js unavailable — starting Canvas2D fallback…');
  try {
    const [{ createState }, { createFallback }] = await Promise.all([
      import('../../../packages/tfl-engine/src/state.js'),
      import('../../../packages/tfl-engine/src/fallback.js'),
    ]);
    const reduceMotion = typeof matchMedia === 'function'
      && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const state = createState({ reduceMotion });
    const canvas = document.getElementById('stage');
    const fallbackCanvas = document.getElementById('fallback2d');
    canvas.hidden = true;
    fallbackCanvas.hidden = false;
    const fallback = createFallback(fallbackCanvas);
    fallback.resize();
    window.addEventListener('resize', () => fallback.resize());
    document.getElementById('boot')?.classList.add('done');
    const status = document.getElementById('statusbar');
    if (status) {
      status.hidden = false;
      status.innerHTML = `Three.js failed to load (${error?.message ?? error}).<br>Backend: <b>Canvas2D fallback</b>.`;
    }
    const interaction = { x: 0.5, y: 0.5, strength: 0 };
    const frame = () => {
      state.simTime += 1 / 60;
      fallback.frame(state, state.simTime, interaction);
      requestAnimationFrame(frame);
    };
    frame();
  } catch (fallbackError) {
    console.error(fallbackError);
    bootMsg(`Startup failed: ${error?.message ?? error}`);
  }
}
