// Thin-film material: TSL / node-based fullscreen procedural shader.
//
// Physical picture (approximate but causal):
//   flow field  -> warped, advected coordinates (transport + vortices)
//   thickness   -> nanometre film height from multi-scale structure,
//                  drainage gradient, surface-tension smoothing, pointer dent
//   normals     -> finite differences of the thickness field
//   interference-> wavelength-dependent phase from optical path difference
//                  2 * n(lambda) * h * cos(theta), sampled at N wavelengths
//   lighting    -> wrap diffuse + Blinn specular + Fresnel on the wet surface
//
// Quality levels rebuild the graph with different constants (octaves,
// spectral samples, normal taps, micro detail), so quality changes alter
// real GPU workload rather than just resolution.

import { Vector2, Vector4 } from 'three/webgpu';
import {
  Fn, uniform, uv, vec2, vec3, vec4, float, mat2,
  fract, floor, sin, cos, exp, sqrt, abs, min, max,
  mix, clamp, smoothstep, pow, normalize, If,
} from 'three/tsl';

export const QUALITY_SPEC = {
  Low:    { oct: 3, spec: 5,  central: false, micro: 0, fineOct: 0 },
  Medium: { oct: 4, spec: 7,  central: true,  micro: 0, fineOct: 1 },
  High:   { oct: 5, spec: 9,  central: true,  micro: 1, fineOct: 1 },
  Ultra:  { oct: 6, spec: 12, central: true,  micro: 1, fineOct: 2 },
};

// Structural field units -> nanometres. Wide enough to span several
// interference orders across a typical frame (vivid banding, not flat tint).
// FIELD_MID is the measured spatial mean of the field (~0.72 on GPU;
// cells/ridges skew it above 0.5), so `filmBase` lands in the middle of the
// actually-rendered thickness range.
const NM_GAIN = 950;
const FIELD_MID = 0.55;

// ---------------------------------------------------------------- helpers

const V2 = (x, y) => vec2(float(x), float(y));

// Stable integer-free hash (no textures required).
// Pure node-builder helpers (plain JS functions composing TSL nodes).
// Only the final graph is a TSL Fn; everything else builds sub-expressions,
// which also allows returning grouped quantities as JS objects.

function hash21(p) {
  const q = fract(p.mul(vec2(0.1031, 0.1030)));
  const d = q.dot(q.add(33.33));
  return fract(q.x.add(q.y).mul(d));
}

function hash21b(p) { return hash21(p.add(vec2(19.19, 7.31))); }

function vnoise(p) {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(vec2(3.0, 3.0).sub(f.mul(2.0)));
  const a = hash21(i);
  const b = hash21(i.add(vec2(1.0, 0.0)));
  const c = hash21(i.add(vec2(0.0, 1.0)));
  const d = hash21(i.add(vec2(1.0, 1.0)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// JS-unrolled fractal Brownian motion (avoids dynamic loop bounds).
function fbmExpr(p, octaves) {
  const rot = mat2(0.8, 0.6, -0.6, 0.8);
  let acc = float(0.0);
  let amp = float(0.5);
  let pp = p;
  for (let k = 0; k < octaves; k++) {
    acc = acc.add(vnoise(pp).mul(amp));
    pp = rot.mul(pp).mul(2.02).add(vec2(13.7, 7.3));
    amp = amp.mul(0.5);
  }
  // normalize roughly to [0,1]
  return acc.mul(1.032);
}

// Single-octave Voronoi F1, JS-unrolled over the 3x3 neighbourhood.
// Gives the cellular /Emulsion-like partitioning of the film.
function voronoiF1(p) {
  const ip = floor(p);
  const fp = fract(p);
  let d = float(8.0);
  for (let gy = -1; gy <= 1; gy++) {
    for (let gx = -1; gx <= 1; gx++) {
      const g = vec2(float(gx), float(gy));
      const o = vec2(hash21(ip.add(g)), hash21b(ip.add(g)));
      const r = g.add(o).sub(fp);
      d = min(d, r.dot(r));
    }
  }
  return sqrt(d);
}

function spectralColor(lam) {
  const r = exp(gauss(lam, 640, 46)).add(exp(gauss(lam, 592, 30)).mul(0.4));
  const g = exp(gauss(lam, 532, 46)).add(exp(gauss(lam, 580, 42)).mul(0.3));
  const b = exp(gauss(lam, 462, 36)).add(exp(gauss(lam, 422, 30)).mul(0.45));
  const edge = smoothstep(380, 422, lam).mul(float(1.0).sub(smoothstep(682, 722, lam)));
  return vec3(r, g, b).mul(edge);
}

function gauss(lam, center, width) {
  const t = lam.sub(float(center)).div(float(width));
  return t.mul(t).mul(-1.0);
}

// ------------------------------------------------------------- material

export function createFilmMaterial(qualityName) {
  const Q = QUALITY_SPEC[qualityName] ?? QUALITY_SPEC.High;

  const U = {
    uTime: uniform(0),
    uAspect: uniform(1.0),
    uRes: uniform(new Vector2(1, 1)),
    uPointer: uniform(new Vector4(0.5, 0.5, 0.0, 0.16)),
    uPointerVel: uniform(new Vector2(0, 0)),
    // Canonical position/radius plus a separately integrated displacement.
    // W gates the optional response; zero is the exact Fixed-compatible path.
    uMotionWarp: uniform(new Vector4(0, 0, 0.19, 0)),
    uMotionWarpVector: uniform(new Vector2(0, 0)),
    // Canonical active position/radius/press displacement and drag vector.
    // Zero displacement is the exact Phase 3A-compatible path.
    uActiveDeformation: uniform(new Vector4(0, 0, 0.19, 0)),
    uActiveDragVector: uniform(new Vector2(0, 0)),
    // Canonical center/radius/gate and the bounded coefficients for a local
    // off-diagonal coordinate shear. A zero vector preserves Phase 3B.
    uCoordinateShear: uniform(new Vector4(0, 0, 0.19, 0)),
    uCoordinateShearVector: uniform(new Vector2(0, 0)),
    uMode: uniform(0),
    uFlowSpeed: uniform(1), uFlowScale: uniform(1.3),
    uTurb: uniform(1), uWarp: uniform(1.1), uVort: uniform(1),
    uFine: uniform(1), uBase: uniform(430), uVar: uniform(0.85),
    uDrain: uniform(0.55), uTension: uniform(0.8),
    uInterf: uniform(1), uSpread: uniform(1),
    uSat: uniform(1.05), uExpo: uniform(1), uContrast: uniform(1.05),
    uFres: uniform(0.9), uSpec: uniform(1), uSharp: uniform(110),
    uAzim: uniform(2.35), uElev: uniform(0.73),
    uLightMotion: uniform(0.3), uHi: uniform(1), uAmb: uniform(0.35),
    uGrain: uniform(0.045),
  };

  const OCT = Q.oct;

  // Structural field value -> film thickness in nanometres.
  const toNm = (f) => U.uBase.add(f.sub(FIELD_MID).mul(NM_GAIN).mul(U.uVar));

  // Warped + advected sampling coordinates. Large structures push and pull
  // smaller ones because every finer layer samples through this warp.
  function advected(st) {
    const tt = U.uTime.mul(U.uFlowSpeed);
    const p = st.mul(U.uFlowScale).add(vec2(tt.mul(0.021), tt.mul(-0.016)));
    // Two counter-rotating vortex centres drifting on incommensurate paths.
    const c1 = vec2(sin(tt.mul(0.11)).mul(1.25), cos(tt.mul(0.087)).mul(0.95));
    const c2 = vec2(cos(tt.mul(0.071).add(2.1)).mul(1.45), sin(tt.mul(0.083).add(1.3)));
    const v1 = p.sub(c1);
    const v2 = p.sub(c2);
    const r1 = v1.dot(v1).add(0.45);
    const r2 = v2.dot(v2).add(0.6);
    const swirl = vec2(v1.y, v1.x.negate()).div(r1).mul(U.uVort.mul(0.55))
      .add(vec2(v2.y.negate(), v2.x).div(r2).mul(U.uVort.mul(0.42)));
    const pq = p.add(swirl);
    // Domain warp: two coarse fbm channels offset the domain.
    const qx = fbmExpr(pq.mul(1.6).add(vec2(tt.mul(0.030), tt.mul(0.021))), Math.max(2, OCT - 2));
    const qy = fbmExpr(pq.mul(1.6).add(vec2(5.2, 1.3).add(vec2(tt.mul(0.017), tt.mul(-0.026)))), Math.max(2, OCT - 2));
    const w = pq.add(vec2(qx, qy).sub(0.55).mul(U.uWarp.mul(2.3)));
    // Curl-like directional advection so bands stretch along the flow.
    const ang = fbmExpr(w.mul(1.35).add(vec2(tt.mul(0.05), tt.mul(-0.037))), Math.max(2, OCT - 2))
      .mul(6.2831).mul(U.uVort.mul(0.85).add(0.15));
    const adv = w.add(vec2(cos(ang), sin(ang)).mul(U.uTurb.mul(0.55)));
    return { adv, warp: vec2(qx, qy), drift: p };
  }

  // Film thickness in nanometres at warped coordinate `adv`.
  // `tap=true` evaluates a calmer variant for surface-normal taps: crease
  // terms (voronoi borders, ridges, capillary) are softened so normals
  // describe the tension-smoothed optical surface. The full field still
  // drives interference color. Without this, discontinuous crease gradients
  // tilt normals everywhere and viewing-angle chaos washes hues toward gray.
  function thicknessAt(pack, fine = true, tap = false) {
    const { adv, warp, drift } = pack;
    const tt = U.uTime.mul(U.uFlowSpeed);
    const base = fbmExpr(adv.mul(1.12), OCT);
    const cells = voronoiF1(adv.mul(2.35).add(warp.mul(1.6)));
    const ridge = float(1.0).sub(abs(fbmExpr(adv.mul(2.65).add(7.7), Math.max(2, OCT - 1)).mul(2.0).sub(1.0)));
    const large = fbmExpr(drift.mul(0.62).add(vec2(tt.mul(0.008), tt.mul(-0.006))), 3);
    let detail = base.mul(0.52)
      .add(cells.mul(tap ? 0.15 : 0.30))
      .add(ridge.mul(tap ? 0.12 : 0.26));
    if (Q.fineOct > 0 && fine) {
      const cap = fbmExpr(
        adv.mul(6.7).add(vec2(tt.mul(0.11), tt.mul(-0.09))),
        Q.fineOct + 1,
      );
      const capRidge = float(1.0).sub(abs(cap.mul(2.0).sub(1.0)));
      detail = detail.add(capRidge.sub(0.5).mul(U.uFine.mul(0.28)));
    }
    // Surface tension pulls the detail field toward the smooth basin field.
    const mixed = mix(detail, large.mul(1.08), clamp(U.uTension.mul(0.55), 0.0, 0.85));
    return { field: mixed, cells, ridge, base, large };
  }

  const graph = Fn(() => {
    const fullUv = uv();
    const fixedSt = vec2(fullUv.x.mul(U.uAspect), fullUv.y)
      .sub(vec2(U.uAspect.mul(0.5), 0.5)).mul(2.0);
    // Qwen-inspired passive motion warp, translated to canonical surface
    // units. It displaces the domain before Fixed flow, vortices, nested warp
    // and thickness structure, so landmarks move coherently. No thickness,
    // normal, lighting or optical response is added here.
    const motionDelta = fixedSt.mul(0.5).sub(U.uMotionWarp.xy);
    const motionRadius2 = max(U.uMotionWarp.z.mul(U.uMotionWarp.z), 0.0009);
    const motionEnvelope = exp(motionDelta.dot(motionDelta).div(motionRadius2).negate())
      .mul(U.uMotionWarp.w);
    const st = fixedSt.add(U.uMotionWarpVector.mul(motionEnvelope.mul(2.0)));

    // Active deformation is also applied before Fixed flow, vortices, nested
    // warp and film structure. Positive radial displacement samples inward.
    // The stored drag vector follows influence velocity, so sampling subtracts
    // it and visible structural landmarks follow the drag direction. Neither
    // component adds film thickness, light or color.
    const activeDelta = fixedSt.mul(0.5).sub(U.uActiveDeformation.xy);
    const activeDistance = sqrt(activeDelta.dot(activeDelta));
    const activeDirection = activeDelta.div(max(activeDistance, 0.0001));
    const activeRadius2 = max(
      U.uActiveDeformation.z.mul(U.uActiveDeformation.z),
      0.0009,
    );
    const activeEnvelope = exp(
      activeDelta.dot(activeDelta).div(activeRadius2).negate(),
    );
    const activeOffset = U.uActiveDragVector.negate()
      .sub(activeDirection.mul(U.uActiveDeformation.w))
      .mul(activeEnvelope.mul(2.0));
    // Real coordinate shear: local Y drives X displacement and local X drives
    // Y displacement. This is an off-diagonal transform, distinct from Active
    // Drag's uniform local translation and Fixed's late scalar thickness term.
    // Normalized cross-axis coordinates and a Gaussian envelope keep the
    // transform bounded at the center, radius edge and fast input speeds.
    const shearDelta = fixedSt.mul(0.5).sub(U.uCoordinateShear.xy);
    const shearRadius = max(U.uCoordinateShear.z, 0.03);
    const shearEnvelope = exp(
      shearDelta.dot(shearDelta).div(shearRadius.mul(shearRadius)).negate(),
    ).mul(U.uCoordinateShear.w);
    const shearCross = vec2(
      clamp(shearDelta.y.div(shearRadius), -1.0, 1.0),
      clamp(shearDelta.x.div(shearRadius), -1.0, 1.0),
    );
    const shearOffset = vec2(
      U.uCoordinateShearVector.x.mul(shearCross.x),
      U.uCoordinateShearVector.y.mul(shearCross.y),
    ).negate().mul(shearEnvelope.mul(2.0));
    const structuralSt = st.add(activeOffset).add(shearOffset);

    const pack0 = advected(structuralSt);
    // Pointer push: velocity advects coordinates near the cursor.
    const pd = fullUv.sub(U.uPointer.xy);
    // Screen-space metric: UV x spans `aspect` times more pixels than UV y.
    // Scaling X (not Y) keeps click/drag influence circular on wide canvases.
    const pdMetric = vec2(pd.x.mul(U.uAspect), pd.y);
    const pdd = pdMetric.dot(pdMetric);
    const pointerVelMetric = vec2(U.uPointerVel.x.mul(U.uAspect), U.uPointerVel.y);
    const push = exp(pdd.div(-0.035)).mul(U.uPointer.z);
    const advPushed = pack0.adv.add(pointerVelMetric.mul(push.mul(1.05)));

    const t0 = thicknessAt({ adv: advPushed, warp: pack0.warp, drift: pack0.drift });
    // Drainage: vertical thinning gradient + pooling inside cells.
    const drainGrad = U.uDrain.mul(fullUv.y.sub(0.5)).mul(-0.5);
    const pool = U.uDrain.mul(t0.cells.sub(0.62)).mul(0.38);
    // Pointer dent + decaying ripple rings.
    const pr = sqrt(pdd.add(1e-5));
    const dent = exp(pdd.div(-0.026)).mul(U.uPointer.z);
    const ripple = sin(pr.mul(42.0).sub(U.uTime.mul(7.0)))
      .mul(exp(pr.mul(-6.0))).mul(U.uPointer.z.mul(0.18));
    const dragShear = pdMetric.dot(pointerVelMetric).mul(exp(pdd.div(-0.045))).mul(U.uPointer.z.mul(-0.20));
    const field = t0.field.add(drainGrad).add(pool).add(dent.mul(0.82)).add(ripple).add(dragShear);

    const hNm = toNm(field);
    const h = max(hNm, 34.0);

    // --- surface normal from thickness gradient ---
    const eps = float(Q.central ? 0.0045 : 0.009);
    const ex = vec2(eps, float(0.0));
    const ey = vec2(float(0.0), eps);
    const gradScale = float(1.3).mul(float(1.25).sub(clamp(U.uTension.mul(0.4), 0.0, 0.6)));
    let gx, gy;
    if (Q.central) {
      const hx1 = toNm(thicknessAt({
        adv: advected(structuralSt.add(ex)).adv, warp: pack0.warp, drift: pack0.drift,
      }, false, true).field);
      const hx0 = toNm(thicknessAt({
        adv: advected(structuralSt.sub(ex)).adv, warp: pack0.warp, drift: pack0.drift,
      }, false, true).field);
      const hy1 = toNm(thicknessAt({
        adv: advected(structuralSt.add(ey)).adv, warp: pack0.warp, drift: pack0.drift,
      }, false, true).field);
      const hy0 = toNm(thicknessAt({
        adv: advected(structuralSt.sub(ey)).adv, warp: pack0.warp, drift: pack0.drift,
      }, false, true).field);
      gx = hx1.sub(hx0).div(eps.mul(2.0).mul(NM_GAIN));
      gy = hy1.sub(hy0).div(eps.mul(2.0).mul(NM_GAIN));
    } else {
      const hx1 = toNm(thicknessAt({
        adv: advected(structuralSt.add(ex)).adv, warp: pack0.warp, drift: pack0.drift,
      }, false, true).field);
      const hy1 = toNm(thicknessAt({
        adv: advected(structuralSt.add(ey)).adv, warp: pack0.warp, drift: pack0.drift,
      }, false, true).field);
      gx = hx1.sub(h).div(eps.mul(NM_GAIN));
      gy = hy1.sub(h).div(eps.mul(NM_GAIN));
    }
    let N = normalize(vec3(gx.mul(gradScale.negate()), gy.mul(gradScale.negate()), float(1.0)));
    if (Q.micro > 0) {
      const m1 = vnoise(structuralSt.mul(47.0).add(U.uTime.mul(0.35))).sub(0.5);
      const m2 = vnoise(structuralSt.mul(59.0).sub(vec2(U.uTime.mul(0.3), 0.0))).sub(0.5);
      N = normalize(N.add(vec3(m1, m2, float(0.0)).mul(U.uFine.mul(0.13))));
    }
    // The pointer must deform the apparent surface, not only change film
    // thickness/color. Add an aspect-correct radial normal tilt plus a smaller
    // directional drag tilt. This makes clicks read as real dimples and drags
    // as pulled membrane rather than as local recoloring.
    const pointerProfile = exp(pdd.div(-0.030)).mul(U.uPointer.z);
    const radialTilt = pdMetric.mul(pointerProfile.mul(4.2));
    const dragTilt = pointerVelMetric.mul(exp(pdd.div(-0.050)).mul(U.uPointer.z.mul(0.42)));
    N = normalize(N.add(vec3(radialTilt.x.add(dragTilt.x).negate(), radialTilt.y.add(dragTilt.y).negate(), 0.0)));

    // --- lighting (independent slow orbit) ---
    const V = vec3(0.0, 0.0, 1.0);
    const az = U.uAzim.add(U.uTime.mul(U.uLightMotion.mul(0.45)));
    const ce = cos(U.uElev);
    const L = normalize(vec3(ce.mul(cos(az)), ce.mul(sin(az)), sin(U.uElev)));
    const H = normalize(L.add(V));
    const ndl = N.dot(L);
    const diff = ndl.mul(0.5).add(0.5);
    const spec = pow(max(H.dot(N), 0.0), U.uSharp).mul(U.uSpec).mul(U.uHi);
    const fres = pow(float(1.0).sub(max(N.dot(V), 0.0)), 3.0).mul(U.uFres);
    const cosT = clamp(N.z, 0.35, 1.0);

    // --- thin-film interference: N spectral samples ---
    let film = vec3(0.0, 0.0, 0.0);
    const NS = Q.spec;
    for (let s = 0; s < NS; s++) {
      const frac = NS === 1 ? 0.5 : s / (NS - 1);
      const lam0 = 400 + 300 * frac;
      const lamS = float(550 + (lam0 - 550));
      // Fixed spectral grid (hue stays faithful to thickness); the Spread
      // control drives inter-wavelength decoherence instead of remapping
      // wavelengths (which would bias the mean hue toward green).
      const lamEff = lamS;
      const nFilm = float(1.34).add(float(550).sub(lamEff).div(550).mul(0.028));
      const phiBase = nFilm.mul(h).mul(cosT).div(lamEff).mul(12.5663);
      const phi = phiBase.add(
        sin(lamEff.mul(0.37)).mul(abs(U.uSpread.sub(1.0)).mul(1.1)),
      );
      const twoBeam = float(0.5).add(cos(phi).mul(0.5));
      const second = cos(phi.mul(2.0).add(1.3)).mul(0.5).add(0.5);
      const R = twoBeam.mul(0.82).add(second.mul(0.18));
      film = film.add(spectralColor(lamEff).mul(R));
    }
    film = film.div(float(NS));
    // Spectral averaging desaturates; expand chroma around the mean so
    // interference bands read as vivid optical color, not pastel mud.
    const filmLuma = film.x.add(film.y).add(film.z).div(3.0);
    film = mix(vec3(filmLuma, filmLuma, filmLuma), film, 1.6);

    const water = vec3(0.012, 0.018, 0.028);
    const lit = U.uAmb.mul(0.65).add(0.35).add(diff.mul(0.85));
    const col = vec3(0.0, 0.0, 0.0).toVar();
    const filmLit = film.mul(U.uInterf).mul(lit);
    const final = water.mul(lit)
      .add(filmLit.mul(1.25))
      .add(vec3(1.0, 0.97, 0.92).mul(spec.mul(0.85)))
      .add(film.mul(fres).mul(U.uInterf).mul(0.9));

    // --- diagnostic views (real simulation quantities) ---
    const hNorm = clamp(h.sub(U.uBase).div(float(NM_GAIN).mul(U.uVar).add(1.0)).add(0.5), 0.0, 1.0);
    const thickView = vec3(hNorm.mul(0.75).add(0.08), hNorm.mul(0.85).add(0.10), hNorm.add(0.16));
    const normalView = N.mul(0.5).add(0.5);
    const flowView = vec3(
      clamp(t0.base, 0.0, 1.0),
      clamp(t0.cells.mul(1.2), 0.0, 1.0),
      clamp(t0.ridge, 0.0, 1.0),
    );
    const interfView = film.mul(U.uInterf).mul(1.4).add(0.02);
    const lightView = vec3(diff.mul(0.55).add(spec).add(fres.mul(0.35)));

    col.assign(final);
    If(U.uMode.equal(1), () => { col.assign(thickView); });
    If(U.uMode.equal(2), () => { col.assign(normalView); });
    If(U.uMode.equal(3), () => { col.assign(flowView); });
    If(U.uMode.equal(4), () => { col.assign(interfView); });
    If(U.uMode.equal(5), () => { col.assign(lightView); });

    // --- grade ---
    let graded = col.mul(U.uExpo);
    graded = graded.sub(0.5).mul(U.uContrast).add(0.5);
    const luma = graded.x.mul(0.2126).add(graded.y.mul(0.7152)).add(graded.z.mul(0.0722));
    graded = mix(vec3(luma, luma, luma), graded, U.uSat);
    // vignette (restrained) + grain/dither
    const vg = st.x.mul(st.x).add(st.y.mul(st.y));
    graded = graded.mul(float(1.0).sub(smoothstep(0.9, 2.4, vg).mul(0.16)));
    const pixel = floor(fullUv.mul(U.uRes));
    const gr = hash21(pixel).sub(0.5).mul(U.uGrain);
    graded = graded.add(gr);
    return vec4(clamp(graded, 0.0, 1.0), 1.0);
  })();

  return { uniforms: U, fragmentNode: graph, spec: Q };
}

// Push smoothed state + environment into material uniforms. Called per frame;
// uniform node `.value` writes are cheap and do not rebuild the graph.
export function updateUniforms(U, s, env) {
  U.uTime.value = env.time;
  U.uAspect.value = env.aspect;
  U.uRes.value.set(env.width, env.height);
  U.uPointer.value.set(env.pointer.x, env.pointer.y, env.pointer.strength, 0.16);
  U.uPointerVel.value.set(env.pointer.vx, env.pointer.vy);
  const motionWarp = env.motionWarp;
  const motionEnabled = motionWarp?.enabled === true
    && motionWarp.effectiveStrength > 0;
  U.uMotionWarp.value.set(
    motionWarp?.position?.x ?? 0,
    motionWarp?.position?.y ?? 0,
    motionWarp?.radius ?? 0.19,
    motionEnabled ? 1 : 0,
  );
  U.uMotionWarpVector.value.set(
    motionEnabled ? motionWarp.displacement.x : 0,
    motionEnabled ? motionWarp.displacement.y : 0,
  );
  const active = env.activeDeformation;
  U.uActiveDeformation.value.set(
    active?.position?.x ?? 0,
    active?.position?.y ?? 0,
    active?.radius ?? 0.19,
    active?.pressDisplacement ?? 0,
  );
  U.uActiveDragVector.value.set(
    active?.dragDisplacement?.x ?? 0,
    active?.dragDisplacement?.y ?? 0,
  );
  const shear = env.coordinateShear;
  const shearEnabled = shear?.enabled === true && shear.effectiveStrength > 0;
  U.uCoordinateShear.value.set(
    shear?.position?.x ?? 0,
    shear?.position?.y ?? 0,
    shear?.radius ?? 0.19,
    shearEnabled ? 1 : 0,
  );
  U.uCoordinateShearVector.value.set(
    shearEnabled ? shear.displacement.x : 0,
    shearEnabled ? shear.displacement.y : 0,
  );
  U.uMode.value = env.mode;
  U.uFlowSpeed.value = s.flowSpeed;
  U.uFlowScale.value = s.flowScale;
  U.uTurb.value = s.turbulence;
  U.uWarp.value = s.warp;
  U.uVort.value = s.vorticity;
  U.uFine.value = s.fineDetail;
  U.uBase.value = s.filmBase;
  U.uVar.value = s.thickVar;
  U.uDrain.value = s.drainage;
  U.uTension.value = s.tension;
  U.uInterf.value = s.interf;
  U.uSpread.value = s.spread;
  U.uSat.value = s.saturation;
  U.uExpo.value = s.exposure;
  U.uContrast.value = s.contrast;
  U.uFres.value = s.fresnel;
  U.uSpec.value = s.specular;
  U.uSharp.value = s.sharpness;
  U.uAzim.value = (s.azimuth * Math.PI) / 180;
  U.uElev.value = (s.elevation * Math.PI) / 180;
  U.uLightMotion.value = s.lightMotion;
  U.uHi.value = s.highlight;
  U.uAmb.value = s.ambient;
  U.uGrain.value = s.grain;
}

// ---------------------------------------------------------------------------
// Approximate CPU mirror of the coarse thickness field, used only by the
// probe readout (single-point evaluation, throttled). It evaluates the same
// parametric structure — large-scale drifting fbm, cellular partitioning,
// drainage gradient, pointer dent — at one UV location.
function h2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}
function vn2(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = h2(ix, iy), b = h2(ix + 1, iy), c = h2(ix, iy + 1), d = h2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
function voronoi2(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  let d = 8;
  for (let gy = -1; gy <= 1; gy++) {
    for (let gx = -1; gx <= 1; gx++) {
      const ox = h2(ix + gx, iy + gy + 7.3);
      const oy = h2(ix + gx + 3.1, iy + gy);
      const dx = gx + ox - fx, dy = gy + oy - fy;
      d = Math.min(d, dx * dx + dy * dy);
    }
  }
  return Math.sqrt(d);
}
function fbm2(x, y, oct) {
  let acc = 0, amp = 0.5, px = x, py = y;
  for (let k = 0; k < oct; k++) {
    acc += vn2(px, py) * amp;
    const nx = 0.8 * px - 0.6 * py, ny = 0.6 * px + 0.8 * py;
    px = nx * 2.02 + 13.7; py = ny * 2.02 + 7.3;
    amp *= 0.5;
  }
  return acc * 1.032;
}

export function sampleFieldApprox(u, v, p, time, pointer) {
  // p: smoothed params, time: sim seconds, pointer: {x,y,strength}
  const tt = time * p.flowSpeed;
  const sx = (u - 0.5) * 2, sy = (v - 0.5) * 2;
  const px = sx * p.flowScale + tt * 0.021;
  const py = sy * p.flowScale - tt * 0.016;
  const qx = fbm2(px * 1.6 + tt * 0.03, py * 1.6 + tt * 0.021, 3);
  const qy = fbm2(px * 1.6 + 5.2 + tt * 0.017, py * 1.6 + 1.3 - tt * 0.026, 3);
  const wx = px + (qx - 0.55) * p.warp * 2.3;
  const wy = py + (qy - 0.55) * p.warp * 2.3;
  const base = fbm2(wx * 1.12, wy * 1.12, 4);
  const cells = voronoi2(wx * 2.35 + qx * 1.6, wy * 2.35 + qy * 1.6);
  const rf = fbm2(wx * 2.65 + 7.7, wy * 2.65 + 7.7, 4);
  const ridge = 1 - Math.abs(rf * 2 - 1);
  const detail = base * 0.52 + cells * 0.30 + ridge * 0.26;
  const large = fbm2(px * 0.62 + tt * 0.008, py * 0.62 - tt * 0.006, 3);
  const tm = Math.min(0.85, p.tension * 0.55);
  let field = detail * (1 - tm) + large * 1.08 * tm;
  field += p.drainage * (v - 0.5) * -0.5;
  const dx = (u - pointer.x), dy = (v - pointer.y);
  const d2 = dx * dx + dy * dy;
  field += Math.exp(d2 / -0.02) * pointer.strength * 0.55;
  const h = Math.max(34, p.filmBase + (field - FIELD_MID) * NM_GAIN * p.thickVar);
  // gradient for normal + flow estimate
  const e = 0.004;
  const gx = (sampleH(u + e, v) - sampleH(u - e, v)) / (2 * e);
  const gy = (sampleH(u, v + e) - sampleH(u, v - e)) / (2 * e);
  function sampleH(uu, vv) {
    const ttx = uu - 0.5, tty = vv - 0.5;
    const ax = ttx * 2 * p.flowScale + tt * 0.021;
    const ay = tty * 2 * p.flowScale - tt * 0.016;
    const bx = fbm2(ax * 1.6 + tt * 0.03, ay * 1.6 + tt * 0.021, 3);
    const by = fbm2(ax * 1.6 + 5.2 + tt * 0.017, ay * 1.6 + 1.3 - tt * 0.026, 3);
    const cx = ax + (bx - 0.55) * p.warp * 2.3;
    const cy = ay + (by - 0.55) * p.warp * 2.3;
    const b2 = fbm2(cx * 1.12, cy * 1.12, 3);
    const c2 = voronoi2(cx * 2.35 + bx * 1.6, cy * 2.35 + by * 1.6);
    const r2 = 1 - Math.abs(fbm2(cx * 2.65 + 7.7, cy * 2.65 + 7.7, 3) * 2 - 1);
    const tm2 = Math.min(0.85, p.tension * 0.55);
    let f = (b2 * 0.52 + c2 * 0.15 + r2 * 0.12) * (1 - tm2)
      + fbm2(ax * 0.62 + tt * 0.008, ay * 0.62 - tt * 0.006, 3) * 1.08 * tm2;
    f += p.drainage * (vv - 0.5) * -0.5;
    return Math.max(34, p.filmBase + (f - FIELD_MID) * NM_GAIN * p.thickVar);
  }
  const k = 1.3 * (1.25 - Math.min(0.6, p.tension * 0.4));
  const inv = 1 / NM_GAIN;
  const nx = -gx * inv * k, ny = -gy * inv * k;
  const nl = Math.hypot(nx, ny, 1);
  return {
    thicknessNm: h,
    thickness01: Math.min(1, Math.max(0, (h - p.filmBase) / (NM_GAIN * p.thickVar + 1) + 0.5)),
    normal: [nx / nl, ny / nl, 1 / nl],
    flow: Math.min(2, Math.hypot(gx, gy) * inv),
    interference: 0.5 + 0.5 * Math.cos((4 * Math.PI * 1.34 * h) / 550),
  };
}
