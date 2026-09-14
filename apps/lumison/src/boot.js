const bootMessage = (text) => {
  const message = document.getElementById('bootMsg');
  if (message) message.textContent = text;
};

try {
  await import('./main.js');
} catch (error) {
  console.error('Lumison main module failed:', error);
  bootMessage('Renderer modules unavailable — starting Canvas2D fallback…');
  try {
    const [{ createState }, { advanceClocks }, { createFallback }] = await Promise.all([
      import('../../../packages/tfl-engine/src/state.js'),
      import('../../../packages/tfl-engine/src/clocks.js'),
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
    document.getElementById('renderStatus').textContent = 'Visual renderer: Canvas2D fallback';
    document.getElementById('boot')?.classList.add('done');
    const frame = () => {
      advanceClocks(state.clocks, 1 / 60, state.current);
      fallback.frame(state, state.clocks.animation);
      requestAnimationFrame(frame);
    };
    frame();
  } catch (fallbackError) {
    console.error(fallbackError);
    bootMessage(`Startup failed: ${error?.message ?? error}`);
  }
}
