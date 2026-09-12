// Minimal bootstrap with no Three.js dependency. If the main application
// module (or its Three.js imports) fails to load, fall back to the Canvas2D
// renderer with default settings instead of leaving a blank screen.
const bootMsg = (t) => {
  const m = document.getElementById('bootMsg');
  if (m) m.textContent = t;
};

try {
  await import('./main.js');
} catch (err) {
  console.error('main module failed:', err);
  bootMsg('Three.js unavailable — starting Canvas2D fallback…');
  try {
    const [{ createState }, { createFallback }] = await Promise.all([
      import('./state.js'),
      import('./fallback.js'),
    ]);
    const state = createState();
    const canvas = document.getElementById('stage');
    canvas.hidden = true;
    const fc = document.getElementById('fallback2d');
    fc.hidden = false;
    const fb = createFallback(fc);
    fb.resize();
    window.addEventListener('resize', () => fb.resize());
    document.getElementById('boot')?.classList.add('done');
    const bar = document.getElementById('statusbar');
    if (bar) {
      bar.hidden = false;
      bar.innerHTML = `Three.js failed to load (${err?.message ?? err}).<br>Backend: <b>Canvas2D fallback</b>.`;
    }
    const ptr = { x: 0.5, y: 0.5, strength: 0 };
    const loop = () => {
      state.simTime += 1 / 60;
      fb.frame(state, state.simTime, ptr);
      requestAnimationFrame(loop);
    };
    loop();
  } catch (err2) {
    console.error(err2);
    bootMsg(`Startup failed: ${err?.message ?? err}`);
  }
}
