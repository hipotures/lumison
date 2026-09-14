// Canvas2D fallback: used only when the Three.js GPU renderer cannot
// initialize at all. Layered moving gradients + interference-ish banding,
// driven by the same state params so controls keep working. Clearly labelled
// as a fallback in the diagnostics UI.
export function createFallback(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  let w = 2, h = 2;
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    w = Math.max(2, Math.floor((canvas.clientWidth || window.innerWidth) * dpr));
    h = Math.max(2, Math.floor((canvas.clientHeight || window.innerHeight) * dpr));
    canvas.width = w; canvas.height = h;
  }

  function spectrum(t) {
    // Compact iridescent palette cycle (display-side only; the GPU path
    // uses the physical interference model).
    const stops = [
      [64, 224, 208], [72, 110, 248], [168, 92, 250], [236, 96, 180],
      [250, 150, 110], [244, 214, 110], [140, 230, 150],
    ];
    const x = ((t % 1) + 1) % 1 * stops.length;
    const i0 = Math.floor(x) % stops.length;
    const i1 = (i0 + 1) % stops.length;
    const f = x - Math.floor(x);
    const a = stops[i0], b = stops[i1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }

  function frame(state, time, pointer) {
    const s = state.current;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#070b12';
    ctx.fillRect(0, 0, w, h);
    const speed = s.flowSpeed * s.temporal;
    const turb = 0.5 + s.turbulence * 0.7;
    const n = 7;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const ph = time * speed * (0.05 + 0.023 * i) * turb + i * 2.4;
      const cx = w * (0.5 + 0.42 * Math.sin(ph * 1.7 + i * 1.3));
      const cy = h * (0.5 + 0.42 * Math.cos(ph * 1.3 + i * 2.1));
      const r = Math.max(w, h) * (0.28 + 0.09 * Math.sin(ph + i));
      const [cr, cg, cb] = spectrum(time * 0.02 * speed + i / n + s.filmBase / 4000);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      const alpha = 0.30 + 0.08 * s.interf;
      g.addColorStop(0, `rgba(${(cr * s.saturation) | 0},${(cg * s.saturation) | 0},${(cb * s.saturation) | 0},${alpha})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    // Interference-ish banding via rotated translucent stripes.
    ctx.globalCompositeOperation = 'overlay';
    const bands = 5 + Math.round(s.thickVar * 6);
    for (let i = 0; i < bands; i++) {
      const ph = time * speed * 0.12 * (1 + i * 0.13) + (i * Math.PI) / bands;
      const [cr, cg, cb] = spectrum(i / bands + time * 0.015 * speed);
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate(ph * 0.4 + (s.vorticity * 0.3 * i) / bands);
      ctx.fillStyle = `rgba(${(cr * 0.5) | 0},${(cg * 0.5) | 0},${(cb * 0.5) | 0},0.16)`;
      const bh = h * 0.16;
      ctx.fillRect(-w, -h / 2 + (i * h) / bands - h / 2 + ((time * 20 * speed * (i % 2 ? 1 : -1)) % (h / bands)), 2 * w, bh);
      ctx.restore();
    }
    // Pointer glow.
    if (pointer.strength > 0.02) {
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(
        pointer.x * w, (1 - pointer.y) * h, 0,
        pointer.x * w, (1 - pointer.y) * h, 130 * (0.5 + pointer.strength),
      );
      g.addColorStop(0, `rgba(180,240,255,${0.25 * Math.min(1, pointer.strength)})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.globalCompositeOperation = 'source-over';
    // Grain.
    if (s.grain > 0.003) {
      ctx.fillStyle = `rgba(255,255,255,${(s.grain * 0.35).toFixed(3)})`;
      for (let i = 0; i < 260; i++) {
        ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
      }
    }
  }

  return { resize, frame, backend: 'Canvas2D fallback' };
}
