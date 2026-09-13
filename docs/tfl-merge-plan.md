# Golden TFL merge and migration plan

## 1. Executive summary

This is a code review and migration proposal, not a merge. Read the root README and `docs/architecture.md` first; their dependency boundaries remain authoritative. No historical implementation is copied by this document.

Use **Fixed as the initial rendering and architectural baseline**, with qualifications. Its ES modules, diagnostic material views, validated parameters and lock-aware controls are the best starting point. Its `state.js` and `main.js` still mix application policy with renderer state and must not be extracted wholesale into the engine. Its Three.js/TSL dependency also needs to become an explicit, pinned rendering dependency in a later implementation task; the initialized repository currently has none.

Preserve **Qwen V1's early coordinate displacement, independent press and motion states, and optional F2−F1 cellular borders**. Preserve **Mobile's broad radial/swirl displacement, propagating ripple displacement, touch gestures and shake recognition**. Mobile's apparent membrane recovery is analytic decay, not a simulated elastic membrane. None of the primary GPU implementations solves a persistent fluid or membrane PDE; a render-to-texture field in Mobile is recomputed each frame, not fed back through time.

Three findings revise the working assumptions:

- Fixed already has spatial displacement and explicit normal tilt, as well as thickness modification. Its weaker perceived pull cannot be attributed to a complete absence of deformation. Displacement enters late and affects only part of the field; normal evaluation is inconsistent with the displaced center sample.
- Fixed and Mobile already contain Voronoi structure. Qwen's unique contribution is a controllable cellular topology with animated nearest/second-nearest cells, per-cell values and border thinning that disappears when disabled.
- Aggressive changes spectral sampling, normal spacing, AA, ripple capacity/lifetime, velocity limits and adaptation thresholds as well as resolution. Its four-element ripple arrays retain six-iteration shader loops. Preserve performance ideas only after independent correction and validation.

Golden TFL should expose continuous spatial influences and timed excitation events, with separate displacement, thickness and lighting responses. Default passive influence can be zero while an optional passive warp reproduces Qwen behavior. Keep Fixed's appearance as a compatibility profile while adding independently calibrated structure and optical profiles. Do not force visually distinct algorithms into identically named sliders with supposedly equivalent values.

## 2. Source implementations reviewed and evidence

All references below are local archive files. Line numbers identify this reviewed revision, not future stable API locations. The review inspected parameter declarations, CPU input/state paths, shader bodies, uniform packing, renderers, fallbacks and orchestration. GLSL and WGSL were compared at the relevant field, interaction and shading stages. No other historical version drives this proposal.

| Reference | Role and principal evidence |
| --- | --- |
| [Fixed](../tmp/thin-film-lab-fixed/) | Primary architectural/visual baseline. `js/film.js`: quality table near 24, `advected` near 157, pointer/normal/optical graph near 213–377; `state.js`: schema, smoothing, snapshot/locks; `input.js`: pointer lifecycle; `presets.js`: presets/mutations; `renderer.js`, `perf.js`, `fallback.js`, `main.js`, `ui.js`: rendering and application boundaries. `index.html` imports local Three modules. Bundled `vendor/three.webgpu.js` inspected read-only for output handling. |
| [Mobile 2.2](../tmp/thin_film_lab_v2_2_mobile.html) | Primary membrane/mobile reference. `PARAMS` near 452, `QUALITY` 501, presets/palettes 512–570; GLSL field and optics 721–1010 and WGSL equivalents 1060–1357; packing 1368; renderers 1398–1801; mutation helpers 1863–1982; gestures/sensors 2333–2554; input 2560–2632; frame loop 2785. |
| [Qwen V1](../tmp/new/qwen-flash-optimized-v1.html) | Primary optional cells and pointer reference. `DEFLIST` 252, `SAFE` 289, presets 307, transitions/mutation 367–442; WGSL `pointerFX` 574, `fluidCoord` 605, `filmBody` 638, `sampleField` 676, `filmColor` 778, `shade` 820, matching GLSL 923–1322; packing 1325; backends 1354–1767; input 1772; adaptation/layout 1868–1923. |
| [Qwen Aggressive](../tmp/new/qwen-flash-optimized-aggressive.html) | Secondary. Full textual diff against V1 reviewed; detailed changes in section 9. The optical/field shader formulas otherwise remain V1's. |
| [SOL](../tmp/thin-film-fluid-laboratory-sol.html) | Secondary source of lost ideas. Parameters 287, `STRUCTURES`/profiles 352–409, tiers 461, WGSL field/optics 597–808 with GLSL counterpart, CPU fallback 1361–1582, pointer 1584 and 1970, structure-aware mutations 1665–1736. |

**Evidence limits:** these are static-code conclusions, combined with the user's reported visual behavior. No browser visual comparison, sensor session, shader compilation or GPU benchmark was performed for this planning task. Runtime claims needing confirmation are identified below. Names such as “physical,” “surface tension,” and “flow” in comments do not establish a physical solver.

## 3. Feature comparison matrix

| Capability | Fixed | Mobile 2.2 | Qwen V1 | Secondary lesson |
| --- | --- | --- | --- | --- |
| Modular application | Separate JS modules | Single HTML with internal sections | Single HTML with internal sections/classes | Retain Fixed separation, refine ownership |
| Field | 2D value-noise fBm, ridges, F1 | 3D gradient noise, ridges, moving F1 | 2D gradient fBm, ridges, optional F1/F2 | SOL has six distinct morphology branches |
| Cellular control | Always included, fixed weights | Always included, density derived from scale | Explicit `cellStructure` | SOL separates family and seed |
| Spatial interaction | Late advection offset | Pre-domain-warp radial/swirl/ripple offset | Pre-flow velocity/press/ripple offset | SOL early velocity advection |
| Passive interaction | None | Sustained broad influence while inside | Motion-dependent transient warp plus glow | SOL fast hover can spawn ripples |
| Persistent disturbances | One decaying current influence | Four aged ripple records | Nominally six aged ripple records; allocator defect | SOL ten-slot ring buffer, quality limits evaluations |
| Normal response | Smoothed base taps + explicit tilt | Texture taps include disturbed field | Local field taps at displaced position; ripple thickness added afterward | SOL samples fully disturbed field |
| Optics | Direct Gaussian RGB spectral approximation | Reflection + transmission, tunable indices/absorption | CIE-style samples/XYZ, normalized two-beam reflection | SOL phase-flipped interference, ACES |
| Palette selection | No independent palette | Five optical/lighting patches | No independent palette | Keep palettes separate from structure |
| Locks | Yes, including import/reset/manual edits | No | No | Use one shared write policy |
| Touch/sensors | Primary pointer | Gesture recognizer + shake-to-randomize | Single pointer | Browser interpretation stays in Lab |
| GPU backends | Three WebGPU / WebGL2 | Custom WGSL / GLSL, two passes | Custom WGSL / GLSL, single pass | Do not maintain three unrelated shader systems |
| Adaptive quality | Effective scale only | Scale and quality; resize propagation issue | Scale and quality | Aggressive also changes work during interaction |
| Canvas fallback | Decorative gradients/stripes | Approximate CPU field/optics; no matching disturbance | Approximate CPU field/optics/interaction | Explicit capability degradation required |
| Diagnostics | Thickness, normals, flow-like field, interference, lighting, CPU probe | HUD/backend/performance | HUD/backend/performance | Retain honest diagnostic labels |

## 4. Simulation and procedural field comparison

### Shared algorithms and what is not shared

All five use deterministic noise sums at multiple scales, time-varying coordinate transforms, optical thickness, gradient-derived normals, interference, and decaying interaction state. All have cellular calculations somewhere in their GPU field. None advects a stored velocity/thickness grid, conserves fluid volume, or numerically solves surface tension. “Drainage” is a procedural thickness/coordinate bias. Memory consists principally of clocks, smoothed controls and ripple records.

The noise is not interchangeable: Fixed uses cubic-interpolated 2D scalar value noise; Mobile uses quintic-interpolated 3D gradient noise with time as a dimension and a 3D rotation between octaves; Qwen uses seeded 2D gradient noise with rotated/offset octaves. Their ranges, normalization, ridge shaping and sample frequencies differ. Matching octave count or `flowScale` will not match geometry.

| Field stage | Fixed | Mobile 2.2 | Qwen V1 |
| --- | --- | --- | --- |
| Coordinates | Centered UV, x corrected for aspect, doubled extent | Centered aspect coordinates without doubling | Centered aspect coordinates without doubling |
| Flow/vorticity | Two drifting counter-rotating centers, rational distance falloff; coarse fBm angle drives directional turbulence | Global rotating/draining coordinates, two Gaussian vortex regions, rotation plus tangential displacement | Radius-dependent twist, anisotropic breathing, finite-difference curl-like offset of coarse noise, slow drift |
| Domain warp | Two coarse fBm channels, gain `2.3*warp`; subsequent angle displacement `0.55*turbulence` | fBm warp followed by noise warp; nonzero base coefficients mean `warp=0` does not disable warp | Two nested fBm warps plus normalized directional component; entire warp contribution scales to zero |
| Main thickness | fBm at 1.12, F1 at 2.35, ridge at 2.65; weights .52/.30/.26 | Positive basin/mid/ridge/cell mixture at .40/1.02/1.85/derived cell frequency | Signed basins at .85, ridged detail at 4.4, optional per-cell plate at frequency 5 |
| Fine detail | Quality-dependent capillary ridge at 6.7; separate normal micro-noise at 47/59 | Multiplicative noise at 6.2/13.4, animated by general clock independently of flow | Frequency `25+90*fineDetail`, amplitude also affected by tension and pixel attenuation |
| Drainage | Additive vertical bias plus F1 pooling | Vertical transport/shear, streak thinning, multiplicative vertical thickness gradient | Additive vertical −250 nm term plus evolving sine bands and noise |
| Tension | Blends detailed field toward broad basin; reduces normal slope | Does not smooth thickness field; increases normal bump multiplier | Reduces fine amplitude and bump, changes Fresnel baseline |
| Thickness units | `filmBase + 950*thickVar*(field−.55)` nm; optical minimum 34 nm | `filmThickness` multiplies positive composite; optical units µm; field clamped about .004–2.35 µm | Base `60+1400*filmThickness` nm; variation `150+1050*thicknessVar` nm; nonnegative |
| Evolution | `simTime*flowSpeed` used within field; changing flow speed changes phase immediately | Accumulated independent general/flow/light clocks; rate changes preserve phase | Time multiplied by current flow/light speed; rate changes can shift phase |

Fixed's source comment mentions a measured mean around .72 but its actual `FIELD_MID` constant is .55. Baseline reproduction must use the executable constant. Its normal field intentionally lowers cell/ridge weights (.15/.12 instead of .30/.26) and omits some detail to keep optical angles calmer; this is an artistic separation worth retaining explicitly.

Mobile's broad interaction radius, moving noise in the third dimension and displacement before the nested warp explain its coherent moving membrane appearance. Increasing its `tension` actually steepens normals; it is not the same smoothing control as Fixed's tension. The temporal grain/fine noise can still evolve when flow speed is zero. Its positive thickness mixture also makes its nominal thickness parameter a scale rather than a mean thickness.

Qwen's `cellStructure` uses `smoothstep(.12,.92,value)`: values near zero suppress the cellular branch entirely. Active cells use animated F1/F2 distances, random values of the nearest two cells, border detection from F2−F1, and strong border thinning toward 14 nm. The low-frequency basins and high-frequency ridges remain when cells are off. This explains why adding only Voronoi F1 to Fixed would not reproduce Qwen. Qwen's 0–1 control is already a continuous hybrid, so classic/cellular/hybrid need not be three hard-coded modes.

**Recommendation:** keep a continuous cell amount with a true zero endpoint, plus separately calibrated cell scale/border influence internally. Preserve Fixed's existing F1 mixture in its compatibility profile rather than silently interpreting it as Qwen's zero-cell state. Keep distinct field profiles for Fixed, Qwen and Mobile initially; blend or consolidate only after landmark comparisons. A single cell slider cannot reproduce differences in noise, flow and thickness construction.

SOL has genuinely different soap, marbling, laminar swirl, filament, cellular-drainage and hybrid branches. Its marbling and filaments use anisotropic warped sine/ridge bands; seeded profiles keep randomization within a morphological family. Preserve these as a documented extension backlog and use their behavior as acceptance references. Do not import six branches merely because they exist. Family-aware random ranges and reproducible seeds are immediately useful design ideas independent of those branches.

## 5. Pointer interaction comparison

### State, coordinates and lifecycle

| Item | Fixed | Mobile 2.2 | Qwen V1 |
| --- | --- | --- | --- |
| Position | UV [0,1], y up, clamped; shader uses aspect metric | Centered, x/aspect corrected; adapter flips y for WebGL, keeps screen-down y for WebGPU/Canvas | Centered x in canvas-height units, y up, based on canvas CSS rectangle |
| Velocity | Event delta / elapsed seconds, dt .004–.08; component clamp ±3, smoothing .42 | Event position minus smoothed position; **not velocity per second** | Frame delta of position smoothed at rate 20/s, dt floor 1/240; vector speed capped at 6, velocity lerp .3 |
| Hover | Tracks probe position, disturbance target zero | Move sets at least .42; target .5 while inside, even stationary | Move accumulates strength up to 1; stationary influence decays, no maintained hover target |
| Down | Primary mouse button, capture; immediate strength ≥.9, target 1.55 | Strength 1, position snapped, one ripple; one active fluid pointer | Press target 1, one ripple, capture; movement strength is independent |
| Drag | Target 1.55 + velocity | Strength increments .18; swirl derived from displacement magnitude | Same velocity effect as hover plus radial press and distance-triggered ripples |
| Pressure | Synthetic scalar, no hardware pressure | Synthetic scalar, no hardware pressure | Smoothed synthetic `press`, no hardware pressure |
| Release/decay | Strength rate 4.5/s, velocity exp(−4dt); while down strength rate 10 and velocity exp(−dt) | Strength approaches inside .5 or outside 0 at 1.9/s; velocity exp(−6dt) | Strength exp(−2.1dt); press exponential response 9/s; position/velocity settles |
| Ripple age | No event age; rings use shared simulation clock | Four FIFO records; age advances by dt × temporal × (.35+flowSpeed), removed after 7 | Intended six records; real-dt age, removed after 5; ages freeze when paused |
| Pause | Field clock stops; pointer still updates | Field clocks stop; pointer **and ripple ages keep updating** | Field/ripple clocks stop; pointer strength and press still update |

Mobile's axis flag is misleadingly named: actual constructor values are WebGPU false, WebGL true, Canvas false; `toAspect` flips when true. Preserve alignment tests, not those names or comments. Fixed's doubled field extent also prevents transferring radius constants directly.

### Spatial deformation versus recoloring

**Fixed:** A Gaussian velocity offset is added to the already computed `pack0.adv`, with gain 1.05 and falloff denominator .035 in squared aspect-correct UV distance. This is real domain deformation: spatial features sampled through `adv` move. However, the associated warp channels and broad `drift` remain unchanged. Then a positive dent (.82 times strength), a current-center sine ripple (.18), and a directional dot-product “dragShear” are added to scalar thickness. That shear term is **thickness modulation**, not a coordinate shear matrix or a transported deformation field. The broad field can stay visually anchored while colors change around it.

Fixed's central normal taps recompute undisplaced advection, reuse center warp/drift and omit the interaction thickness terms. It compensates with explicit radial normal tilt (4.2) and directional drag tilt (.42). Low-quality forward taps compare a different, calmer field to the fully modified center thickness, potentially magnifying the mismatch. This coupling explains why a nominally present displacement may still feel like local color editing. Diagnose with an unlit structural checker/field view, not interference color alone.

**Qwen:** `pointerFX` separates vector displacement, added thickness and glow. Gaussian radius is .19 in centered height units. Displacement combines velocity × motion strength × .5 with inward radial press × .09; gain multiplies both. `shade` offsets coordinates **before** `fluidCoord` and `warpCoord`, so the whole subsequent structure moves together. Passive motion therefore works without press; it is a velocity warp, not an optical refraction solver. Stationary hover fades. Active press adds a radial lens and active movement adds ripple records; there is no separately adjustable active velocity multiplier yet.

Each ripple contributes both radial spatial displacement (.010 coefficient) and a 330 nm thickness oscillation, with spatial exp(−3.2r) and age exp(−1.1age) decay. Glow is additive light, not geometry. Normals sample `filmBody` locally in warped coordinates at the displaced point; they do not include the complete coordinate Jacobian, and `pt.add` is added after those derivatives. Port the coordinate mechanism first, then reconcile surface derivatives without losing compatibility.

A code defect limits V1's advertised persistence: `spawn` chooses the largest age even when unused slots exist. Once a live slot has age >0, it beats empty slots at age 0 and is repeatedly overwritten. The intended six-ripple history is therefore generally reduced to one live ripple from a fresh state. Golden TFL must choose an inactive slot first, then evict the oldest; SOL's ring buffer is another useful reference.

**Mobile:** The main field adds broad radial displacement with exp(−3.1r²), .26 amplitude, plus tangential displacement × swirl × .55 **before domain warp**. Swirl is speed-magnitude based and nonnegative; it does not encode signed pointer angular motion or directional drag. Each ripple displaces radially using a moving phase front `age*1.05`, frequency 15.5, coefficient .115 and spatial/age decay. A Gaussian front envelope gates emission, while displacement extends beyond that envelope. JS also decays ripple strength, so shader and record decay multiply. The displaced field is written to a texture and its thickness gradients drive normals. Disturbance emission also multiplies thickness by `1+.30*emit` and adds light later. These effects must be separated to keep deformation without obligatory whitening.

Mobile does not emit ripples continuously on drag; pointer-down creates them. There is no accumulated elastic state. Recovery is easing of radial/swirl strength and aged waves. Its no-button hover remains active, unlike the desired Fixed default.

**SOL:** Normalized top-down coordinates, aspect correction in shader, event velocity per second clamped ±6 and smoothed .4. Movement accumulates activity; velocity advects coordinates before morphology evaluation. Fast movement (>1.2 UV/s, spaced by >.12 s) emits ripples even without a button. Down adds three nearby waves and sets a decaying press impulse, not sustained held pressure. Dent and ten stored waves alter thickness; full `filmAt` taps include these changes in normals. This is a useful multi-event/derivative reference, but its hover ripple policy should not become the default.

### Future interaction representation

Use source-neutral spatial influences plus timed events, in centered surface coordinates measured in viewport-height units, y up. Origin is the view center; x spans ±aspect/2 and y ±.5. Velocity is surface units/second, radius uses the same metric. Engine render backends own UV/y conversion; input adapters map CSS rectangles to the public surface metric. Resize must preserve defined positions or explicitly remap them, and must never infer velocity from the resize itself.

An influence has an opaque id, position, radius, direction/velocity and independent strengths for velocity displacement, radial displacement, tangential displacement, scalar thickness offset and optional emission. It also has attack/release times. “Passive” and “active” are Lab mapping policies: both submit the same data contract with different gains. Maintain bounded concurrent influences so future independent controls do not overwrite one global pointer.

A timed ripple has origin, start time, amplitude, radius/front speed, frequency and decay, with independent displacement/thickness/emission gains. Excitation can be represented by a finite-duration radial influence plus optional ripple; do not add several redundant `excite/disturb/drag` methods until distinct semantics require them. True coordinate shear may later need a directional deformation component; Fixed's scalar shear is not sufficient evidence that one already exists.

Evaluate a shared displaced surface for structural and normal diagnostics, with an explicit optional smoothed normal surface for Fixed fidelity. Establish consistent derivatives before calling this “physical” deformation. If analytic waves still fail the pull/recovery acceptance test, scope a separate persistent displacement/velocity texture experiment; a solver is not required merely to port these prototypes.

## 6. Optical and color pipeline comparison

| Stage | Fixed | Mobile 2.2 | Qwen V1 |
| --- | --- | --- | --- |
| Spectrum | 5/7/9/12 fixed 400–700 nm Gaussian RGB samples | 5/7/9/13 samples, midpoint grid roughly 365–725 nm, analytic XYZ functions | 3/5/7/9 precomputed CIE-style XYZ/wavelength tables |
| Film phase | 4π n h cosT / λ; two-beam cosine plus .18 second harmonic | Dispersive index, Snell term, rational multiple-reflection expression with extra π phase | Two-interface amplitude expression with coherence exp(−abs(OPD)/3000) |
| Index | Fixed dispersive ~1.34 | User film/substrate indices; wavelength correction .0135/λ² | Spatially varying ~1.30 plus .07 noise, wavelength dispersion; substrate fixed 1.05 |
| Absorption/transmission | No absorption or transmission model; dark water base | Wavelength-dependent exponential attenuation for reflection and transmission | No user absorption; back term attenuated exp(−thickness/1400) |
| Spread | Phase decoherence proportional to abs(spread−1), fixed wavelength grid | Width of XYZ matching functions | Multiplies optical path difference |
| Interference control | Scales film contribution | Nonlinear luminance-dependent gain plus shared RGB gain | Scales cosine modulation in normalized reflectance |
| Spectral normalization | Divide by sample count; expand chroma around mean by 1.6 | Divide XYZ by per-channel sums, matrix and white correction, divide by mean interface reflectance | Divide XYZ by sum of Y weights, matrix, clamp negatives; reflectance normalized by interface amplitudes |
| Normals/view | Calmer gradient field + micro/interaction tilt; fixed front view, cosT clamp .35 | Texture differences, resolution-dependent slope; perspective-like view | Warped-field derivatives, small bump coefficient, perspective-like view with offset |
| Lighting | One wrap-diffuse light, warm specular .85; dark base | Two wrap lights, environment, transmission, two specular lobes, curvature, edge light, disturbance emission | Three diffuse lights, environment, two specular lobes, curvature/edge/back contributions, pointer glow |
| Fresnel | Cubic grazing term, film-tinted addition | Fourth power; F0 .03 baseline; also separate colored edge addition | Fourth power with tension-dependent F0, environment/specular contribution |
| Highlight/specular | Product of strengths for specular; diffuse independent of highlight | Highlight scales diffuse and both specular lobes | Highlight scales diffuse, specular and edge strength |
| Tone/grade order | Exposure → contrast → saturation → vignette/grain → clamp; renderer NoToneMapping | Exposure → ACES fit → gamma 1/2.2 → contrast → saturation → grain/dither → clamp | Exposure → ACES fit with internal .6 input scale → gamma 1/2.2 → contrast → saturation → vignette/RGB grain → clamp |
| Grain | Static monochrome pixel hash, default .008 | Animated monochrome grain .018 plus independent 1/255 dither | Time-salted independent RGB noise, default .05 |

Fixed's shader has no explicit gamma power, but that does **not** establish a gamma-free canvas. The bundled Three renderer defaults to `SRGBColorSpace` and owns output conversion. Freeze the complete renderer/material/output configuration when capturing a baseline; verify the actual output route before introducing another gamma or ACES stage. Shader-only screenshots or formula comparisons cannot establish final display equivalence.

Mobile's refractive-index guard (`substrateIndex <= filmIndex−.05`) is a prototype policy, not a universally valid optical constraint. It is applied in tweening and packing as well as presets. Any unified optical profile must explicitly define its supported index relation and phase convention; do not “correct” the physics and simultaneously expect pixel fidelity. Likewise, a palette in these prototypes is a bundle of optical settings, not a sampled RGB lookup texture.

## 7. Why Mobile 2.2 becomes bright, white or milky

The code supports multiple interacting causes, with different behavior on GPU and Canvas. Lower exposure reduces final energy but does not remove the upstream coupling or restore spectral contrast lost during averaging.

1. **Reflection normalization lifts the mean.** `thinFilm` divides each accumulated XYZ channel by its own spectral weight sum, applies XYZ-to-RGB and `WPAP` correction, then multiplies by `1/meanR`, where `meanR` is the sum of squared interface amplitudes. At default indices 1.42/1.03, meanR is approximately .0553, so that gain is about 18.1. This primarily raises naturally small interface reflection toward order-one brightness; it is not evidence of an 18-fold display increase in isolation. Fixed instead averages bounded cosine reflectances over RGB basis functions and starts from a very dark base.
2. **The interference parameter amplifies brightness nonlinearly.** Mobile measures reflected luminance relative to 1 and multiplies the entire RGB vector by a factor clamped to [0,6], proportional to `1+1.9*interference*(luma−1)`. Bright spectral combinations are boosted further. This is neither a simple fringe contrast control nor chroma expansion.
3. **“Chroma” is actually an intensity multiplier.** Packing sets `gChroma=.35+1.3*interference` (1.65 at default). The subsequent mix weight is literally 1, selecting `refl*gChroma` and `tran*gChroma`; there is no interpolation around luminance. This multiplies reflection **and transmission**, further tying brightness to interference. Fixed's 1.6 chroma expansion instead mixes around mean color.
4. **Spectral spread and AA can smooth away hue separation.** Spread broadens matching functions, making channels overlap more. Spectral AA averages neighboring thicknesses using screen derivatives, mixing interference phases where gradients are large. These are useful antialiasing/softness choices but can produce pale broad responses; neither means that exposure alone is too high.
5. **Lighting adds several partly white terms.** Two wrapped diffuse lights provide fill even on surfaces facing away from a light. Environment reflection, transmission, a mostly white specular tint (only .34 film tint), a second broader specular lobe, curvature enhancement and a colored Fresnel edge are added. At default sharpness 60 the highlights are broader than Fixed's 110; the exponent is only one part of the difference because normals and light axes differ too. Highlight strength controls both diffuse and specular in Mobile, whereas Fixed's highlight scales specular only.
6. **Interaction also injects light and thickness.** Sustained inside strength .5 can affect a large region without pressing. Field emission boosts thickness, adds blue-white radiance and contributes turbulence brightening; pointer backlighting adds another term through transmission. Its backlight distance uses `uv−gPtr` despite `gPtr` being centered aspect coordinates, then applies aspect again. This is a coordinate mismatch separate from the correctly centered field interaction and may offset the bright patch. Decouple and align it later.
7. **Normals and resolution change optical response.** Mobile's gradients are raw neighboring texture differences, not divided by physical sample spacing. Bump grows with tension. Downsampling can therefore alter angular interference, highlights and Fresnel, not merely blur the same picture. RGBA8 field fallback also clips thickness above 1 µm and emission above 1 instead of encoding the declared field range; this can flatten normals and produce unintended plateaus.
8. **Tone mapping and display grading compress bright channels together.** Mobile's ACES fit has no Qwen-style .6 pre-scale. An input of 1 maps to about .804, then gamma lifts it to about .905 before contrast/saturation. High-energy RGB channels converge near white; post-tone contrast can clip them further. For comparison, Qwen's .6 input maps near .673 before gamma. Fixed preserves a different dark range through its spectral normalization, restrained additions and pre-output grading; simply transplanting its exposure number is not a calibration.
9. **Canvas has an additional severe normalization problem.** `canvas2dRender` calls `specToRGB(Xr0/Yr0, Yr0/Yr0, Zr0/Yr0, ...)`, fixing Y to 1 for nonzero Yr0 and discarding absolute reflected luminance. Then `specToRGB` divides by `meanR*3`, applies the luminance-dependent gain without the GPU's upper cap, and multiplies RGB again. It is therefore especially prone to bright saturation and does not validate the GPU optical pipeline. It also omits the GPU interaction field and much of transmission/environment shading. Identify the actual backend before attributing a user's bright frame to one formula.

**Controlled investigation during migration:** freeze seed, clocks, viewport, backend and quality; disable adaptive resolution; record raw field/normals, reflected/transmitted color, diffuse, specular, environment, interaction emission and final output separately. Compare with pointer absent, hovering, held and released. Sweep normalization, RGB gain, spectrum width, spectral AA, normal strength, highlight/specular and exposure one at a time. Record luminance percentiles, near-white/clipped pixel fraction and chroma distributions alongside images. Repeat WebGPU/WebGL2 and float/non-float capability cases. This distinguishes energy buildup from spectral desaturation and fallback defects; no new default should be chosen from an exposure-only test.

## 8. Parameter mapping table

Notation: `name [min..max; default]`. These are schema defaults, not necessarily startup values: Fixed applies Soap Film on a fresh start; labels/persistence/presets can override values in every prototype. “Direct” means the scalar's operation/unit is comparable, **not** identical rendered results. S = simulation, O = optics, L = lighting, R = rendering, I = interaction. All rows marked “keep” belong in engine configuration; UI labels/ranges displayed in Lab can be friendlier projections of that configuration.

| Meaning / owner | Fixed | Mobile 2.2 | Qwen V1 | Direct mapping? Unified decision |
| --- | --- | --- | --- | --- |
| Flow rate / S | `flowSpeed [0..2.5;1]` | `flowSpeed [0..2.5;.55]` | `flowSpeed [0..2.5;.55]` | Rate concept only; keep, accumulate phase continuously |
| Structure frequency / S | `flowScale [.4..3.5;1.3]` | `flowScale [.15..4;1.15]` | `flowScale [.3..3.2;1.05]` | No, domain extent/frequencies differ; keep with profile calibration |
| Turbulence / S | `turbulence [0..2;1]` | `turbulence [0..2;.85]` | `turbulence [0..1.6;.78]` | No, different field terms; keep |
| Warp / S | `warp [0..2.5;1.1]` | `warp [0..2.5;1.15]` | `warp [0..2.2;.95]` | No, Mobile nonzero floor; keep |
| Swirl/vorticity / S | `vorticity [0..2.5;1]` | `vorticity [0..2;.78]` | `vorticity [0..1.8;.72]` | No, rational vortices vs Gaussian vs twist/curl; keep |
| Fine detail / S | `fineDetail [0..2;1]` | `fineDetail [0..1.5;.55]` | `fineDetail [0..1;.44]` | No, frequency/amplitude/normal coupling; keep, disentangle as needed |
| Cellular topology / S | —, implicit F1 | —, implicit F1 | `cellStructure [0..1;.20]` | Unique exposed control; keep continuous amount with exact off endpoint |
| Base thickness / S | `filmBase [80..1000;430]` nm | `filmThickness [.05..2.4;.62]` µm scale | `filmThickness [0..1;.42]` normalized base | No; canonical nm, legacy conversion described below |
| Thickness variation / S | `thickVar [0..1.6;.85]` | `thickVar [0..1.6;.95]` | `thicknessVar [0..1;.62]` | No, additive amplitude vs multiplicative mixture; keep |
| Drainage / S | `drainage [0..1.5;.55]` | `drainage [0..1;.38]` | `drainage [0..1;.3]` | No, different transport/gradient/pooling; keep |
| Surface smoothing / S | `tension [0..1.5;.8]` | `tension [0..1.5;.55]` | `surfaceTension [0..1;.55]` | **Conflict:** Mobile increases bump, others damp; split smoothing from normal strength |
| Interference / O | `interf [0..1.5;1]` | `interference [0..2;1]` | `interference [.1..1.6;1]` | No: energy, nonlinear gain, fringe amplitude; profile-specific conversion |
| Spectral control / O | `spread [.2..2.5;1]` | `spectralSpread [.4..2.2;1]` | `spectralSpread [.45..2;1]` | **No:** decoherence vs CMF width vs OPD scale; retain distinct semantics internally |
| Saturation / R | `saturation [0..2;1.05]` | `saturation [0..1.8;1.06]` | `saturation [0..1.8;1.08]` | Same luma-mix concept, different stage; keep |
| Exposure / R | `exposure [.2..2.2;1]` | `exposure [.15..3;1.05]` | `exposure [.25..2.6;1.05]` | Direct linear gain, surrounding pipeline differs; keep |
| Contrast / R | `contrast [.5..1.8;1.05]` | `contrast [.4..2.2;1.08]` | `contrast [.6..1.8;1.12]` | Pivot .5 shared, stage differs; keep |
| Fresnel gain / O | `fresnel [0..2;.9]` | `fresnel [0..2;1]` | `fresnel [0..2;.95]` | No, powers/base/edge terms differ; keep |
| Specular gain / L | `specular [0..2.5;1]` | `specStrength [0..3;1]` | `specular [0..2.5;1.05]` | Gain concept only; keep |
| Specular exponent / L | `sharpness [8..320;110]` | `specSharpness [2..220;60]` | `specSharp [0..1;.62]` | Fixed/Mobile exponent comparable; Qwen `8+752*x^1.5`, then curvature modifies it; keep exponent/roughness convention explicit |
| Film index / O | —, hard-coded dispersion | `filmIndex [1.15..2.3;1.42]` | —, procedural index | New exposed engine capability; keep with optional spatial variation/profile |
| Substrate index / O | — | `substrateIndex [1..1.6;1.03]` | —, constant 1.05 | New exposed capability; keep |
| Absorption / O | — | `absorption [0..1;.32]` | —, fixed thickness attenuation for backlight | New exposed capability; keep; define wavelength/unit scaling |
| Light azimuth / L | `azimuth [0..360;135]` | `lightAz [0..360;132]` | `lightAz [0..360;126]` | Degrees shared, axes differ; keep with one engine convention |
| Light elevation / L | `elevation [5..85;42]` | `lightEl [5..88;44]` | `lightEl [2..86;42]` | Fixed z-up light vs others y-elevation; orientation conversion needed |
| Light motion / L | `lightMotion [0..1.5;.3]` | `lightMotion [0..2;.38]` | `lightSpeed [0..2;.42]` | No, orbit laws/clocks differ; keep accumulated light clock |
| Highlight / L | `highlight [0..2;1]` | `highlight [0..3;1.15]` | `highlight [0..3;1.2]` | No, specular-only vs diffuse/specular; keep independent light gains internally |
| Ambient / L | `ambient [0..1;.35]` | `ambient [0..1.2;.26]` | `ambient [0..1.4;.36]` | Gain concept only; keep |
| Global time rate / S | `temporal [0..2.5;1]` | `temporalSpeed [0..2;1]` | `temporalSpeed [0..2.5;1]` | Comparable clock rate; event aging differs; keep |
| Requested resolution / R | `renderScale [.25..1.5;1]` | `renderScale [.4..2;1]` | `renderScale [.3..1.5;1]` | Same intent, DPR/caps differ; keep separate requested/effective values |
| Interaction gain / I | —, constants | —, constants | `pointerGain [0..2;1]` | Keep as source-neutral gain plus separate mechanism strengths |
| Grain / R | `grain [0...08;.008]` | `grain [0...12;.018]` | `grain [0...3;.05]` | Amplitude comparable, monochrome/RGB and time differ; keep profile options |

Qwen's default thickness base converts to 648 nm, with variation scale 801 nm; Fixed's base is 430 nm. Mobile's .62 corresponds to a 620 nm **multiplier**, not a 620 nm mean. Multiplying Mobile's slider by 1000 changes units but does not map its field distribution to Fixed. Preserve source-specific thickness construction in import/profile metadata, then calibrate canonical mean/amplitude separately. Qwen variation never reaches zero amplitude even when its slider is zero.

The same distinction applies to azimuth: Fixed constructs `(cos(el)cos(az), cos(el)sin(az), sin(el))`, while Mobile/Qwen place elevation on y and use different x/z trigonometric order. At rest, vector conversion can map directions; their animated multi-light rigs cannot be replaced by an azimuth rename.

### System settings and interaction constants outside the numeric schemas

| Setting / owner | Fixed | Mobile | Qwen V1 | Unified decision |
| --- | --- | --- | --- | --- |
| Quality / R | Low/Medium/High/Ultra; High default | Same four; high | Same four; high | Keep, describe actual per-profile work; do not promise identical visual content across tiers |
| AA / R | `msaa` 0/2/4, default 0; constructor only checks >0 | `aa` 1/2/3, default 2, thickness spectral taps | `aa` 1/4/9, default 4, full shade supersamples | Separate raster MSAA, spatial sampling and spectral filtering; no enum rename |
| Adaptation / R | `adaptive=true`, scale-only | `adaptive=true`, factor + quality | `adaptive=true`, factor + quality | Keep budget policy; actual setting changes opt-in |
| Frame budget / R | `targetFps` 30/60/90/120;60 | Same | Same | Keep target, cap interpretation to display capability |
| Diagnostics / R + UI | `diag` six views, `probe=false` | HUD | HUD | Engine returns quantities/stats; UI owns selector and probe overlay |
| Pause / S | `paused=false` | Same | Same | Define independent animation pause vs interaction freeze explicitly |
| Seed / S | No exposed structural seed | Packed constant 12.9898 | Random 1..65535 and random starting time | Add deterministic seed/time configuration; snapshot separately from presets |
| Locks / policy, UI | `locks={}`, persisted | None | None | Shared source-neutral parameter policy; Lab lock widgets |
| Influence strength / I | 0..1.55, click floor .9 | 0..1 with .5 inside target | motion 0..1; press 0..1 | Independent amplitudes; passive disabled in baseline |
| Radius / I | Different Gaussian widths .026/.030/.035/.045/.050; pointer w=.16 unused | exp(−3.1r²), broad equivalent radius ~.568 | .19, minimum .03 | Public radius and profile response; constants not directly transferable |
| Velocity/swirl / I | UV/s ±3 per component | displacement, swirl magnitude capped 1.4 then 1.6 | height units/s, vector cap 6 | Normalize adapter units and use dt-aware smoothing |
| Ripple limits / I | One analytic cursor ring | Four, age cutoff 7 flow-scaled units | Six intended, 5 seconds | Bounded event store with explicit overflow/clock semantics |
| UI state / UI | panel/collapse/probe/preset labels, storage | mobile/help/haptic/shake preferences, palette label | panel/hidden UI/preset labels | App-owned; never shader uniforms or engine browser dependencies |

Fixed-only names are mostly aliases (`filmBase`, `interf`, `spread`, `temporal`), not uniquely missing Mobile capabilities. Its actually unique controls are locks, diagnostic views/probe and raster-MSAA selection. Mobile adds film/substrate indices, absorption, independent palette selection and spectral AA; Qwen adds explicit cellular amount and global interaction gain. Neither primary exposes independently switchable hover/drag/shear/ripple mechanisms yet.

## 9. Rendering and backend comparison

**Fixed:** Three `WebGPURenderer`, fullscreen plane/orthographic camera and custom TSL `NodeMaterial.fragmentNode`. It attempts WebGPU/automatic WebGL2, then forced WebGL2 with initialization timeouts, then a separately managed Canvas fallback. Quality rebuilds the material graph: 3/4/5/6 main octaves, 5/7/9/12 spectral samples, forward versus central normals and optional fine/micro detail. The 0/2/4 MSAA UI currently becomes only an `antialias` boolean; sample-count distinctions are not wired explicitly. Raster MSAA does little for shader-internal interference aliasing on a fullscreen primitive.

Fixed's adaptive controller lowers effective scale in .10 steps to .25, checks 2.5-second windows, needs two bad or three good windows and uses a five-second cooldown. It retains the user's material quality and never exceeds requested scale. The main loop caps the effective FPS target to its display estimate and honors a locked render scale. This is the best default policy, although frame duration is not a GPU timestamp.

**Mobile:** Custom WebGPU/WGSL and WebGL2/GLSL with separate procedural-field and shading passes. A float texture stores thickness/turbulence/cell/emission, so shading can cheaply sample nearby field values instead of redoing all noise. It is not a temporal simulation buffer. WebGPU uses RGBA16F field data; WebGL attempts RGBA16F then RGBA8, with the unencoded clipping problem described above. Tiers use main octaves 3/4/5/6, warp octaves 1/2/2/3, spectral samples 5/7/9/13 and extra normal taps. Spectral AA does not rerender the entire field for each tap.

Mobile caps DPR at 2.5, buffer dimensions at 4096 and area at 8.6 million pixels. Independent dimension clamps can also change aspect at extreme ratios. Its adaptation lowers factor by .12 to .5 then quality, and attempts recovery below 70% of target frame time. However, `Adaptive.update` changes factor/quality without setting `App.needsResize`; the frame only resizes when flagged. Quality uniforms update, but effective scale can remain stale until another resize trigger. Its reported “gpu” duration measures JS render submission, not completed GPU work. Device loss reports a message; this is not the same recovery guarantee as successful fallback at startup.

**Qwen V1:** Explicit WebGPU, WebGL2 and CPU Canvas renderer classes, one fullscreen shader pass. Each shade sample evaluates center and four neighbor thickness samples; AA 4/9 repeats most shading work. Quality supplies two octave counts (2/3 through 5/6), spectrum 3/5/7/9 and normal-spacing factors 2/1.4/1/.7. Analytic fine-detail attenuation depends on frequency per output pixel. Dynamic scale .45–1 is separate from user scale; effective pixel ratio is clamped .25–2.5. Adaptation can also change the chosen material tier, and its recovery threshold of <.74 target frame time is difficult to reach on a display capped at that target. Shader parity is handwritten, with approximate CPU differences: CPU cellular border thinning is much weaker than GPU, among other field/lighting simplifications. Do not claim backend equivalence.

Qwen tries successive renderer types on the same canvas; after acquiring one context, attempting a different context type is a lifecycle hazard, especially after a late initialization failure. Mobile creates a fresh canvas per startup attempt. Unified fallback must own context disposal/replacement deliberately and preserve state across failures.

### Exact Aggressive delta and preservation decision

The complete V1→Aggressive textual diff changes only these functional areas plus title/storage identity:

| Change | V1 → Aggressive | Decision |
| --- | --- | --- |
| Base tiers | Main octave pairs 2/3,3/4,4/5,5/6 → 1/2,2/3,3/4,4/5; spectrum 3/5/7/9 → 3/3/5/7; normal factor 2/1.4/1/.7 → 2.5/1.8/1.25/.95 | Optional economy profile, not the same named visual quality |
| Defaults/resets | high + AA4 → medium + AA1 | Explicit budget preference only; unchanged presets can override it |
| Ripple budget | JS/uniform arrays 6 → 4, but shader loops remain 6 | **Do not port:** out-of-bounds access/validation risk; fix capacity contract later |
| Motion work control | New score from speed×.12 + press×.7 + strength×.35, clamped 0..1 | Engine may accept generic activity hints; never access a pointer object |
| AA/octaves/spectrum | Motion >.02 forces AA1; >.04 removes one octave and two spectral samples; >.55 removes another octave/sample; minimums enforced | Optional only; threshold popping and hue changes likely |
| Normal spacing | Multiply tier factor by `1+.45*motion` | Alters appearance; not a transparent speedup |
| Fine attenuation | Denominator threshold .30 → .30+.09×motion | **Less** attenuation at higher motion, not stronger filtering; validate aliasing tradeoff |
| Drag events | Distance threshold .05 → .085; amplitude .3+strength capped 1.1 → .28+strength capped 1 | Changes feel/history, not just performance |
| Velocity/lifetime | Cap 6 → 4.5; record lifetime 5 → 3.5 seconds | Keep independent from quality budget |
| Adaptive windows | 30 → 18 samples; cooldown 1200 → 700 ms; slow threshold 1.12 → 1.06 target; fast .74 → .68 | Optional tuned policy only; recovery becomes harder under VSync |
| Adaptation steps | Two slow windows → one; four fast → three; scale floor .45 → .36, multiplier .86 → .82; recovery 1.06 → 1.08; after tier descent scale .9 → .86 | Needs sustained device tests and requested/effective separation |
| Interaction resolution | New score speed×.10 + press×.9 + strength×.25; up to 22% reduction; more per-frame size checks and last-adaptive-scale tracking | Potentially useful optional resolution-only behavior with hysteresis |
| Persistence | Separate `.aggressive` storage key | Keep profile/version identities, not legacy storage coupling |

No new visual field or optical algorithm justifies making Aggressive the primary visual source. Also test full resolution restoration after activity decays below the resize conditions; per-frame buffer resizing can cost more than it saves. Do not let optional economy behavior silently override `adaptive=false`, a render-scale lock or a reproducible capture.

**Engine backend direction:** retain Three/TSL initially, within a small renderer boundary. Port mathematical capabilities into that pipeline in later work, not parallel full applications or wholesale WGSL/GLSL strings. Evaluate Mobile's two-pass field cache after baseline and interaction correctness; it may reduce redundant noise work but adds memory/bandwidth, texture-format constraints and altered derivative behavior. No new framework is proposed. Browser canvas/context access is a legitimate renderer responsibility; browser gesture recognition is not.

## 10. Mobile and input ownership

Mobile 2.2 is a useful interaction policy reference, not a general multi-contact simulation. Two or more contacts are reserved for parameter gestures; the engine sees one fluid pointer in the historical implementation.

| Historical behavior | Exact recognition/mapping | Future owner |
| --- | --- | --- |
| One-finger drag | Captured stage pointer, radial/swirl influence, down ripple | Lab pointer adapter emits generic influence/event; engine evaluates field |
| Pinch | Two contacts; abs(log(distance ratio)) >.055; multiply starting `flowScale` by ratio | Lab gesture adapter → validated parameter transaction |
| Two-finger translation | Movement >18 px; vertical if abs(dy)>1.15×abs(dx); exposure changes −dy/height×2.1, otherwise spread +dx/width×2.2 | Lab gesture adapter; parameter meaning must follow selected optical profile |
| Double tap | Tap <420 ms, movement <24 px; second within 340 ms and 42 px | Lab command mapping → mutate policy |
| Two-finger tap | Tap criteria above, two contacts | Lab → randomize policy |
| Three-or-more tap | Same tap criteria | Lab UI visibility only |
| Long hold | One contact, <14 px motion, 780 ms | Lab advanced controls / UI restore |
| Edge rail swipe | Inset rail 56–78 px; vertical >90, horizontal <70, <1100 ms | Lab left mutate / right randomize mapping |
| Shake | Finite acceleration magnitude, or change in gravity-including magnitude; >13.5 twice within 520 ms, 1300 ms cooldown | Lab sensor adapter and randomize mapping |
| Sensor permission | DeviceMotion permission where available, preference persistence, no-data timeout | Lab/browser integration |
| Quick controls | Pause, mutate, randomize, Tune, hide, Shake; mobile detection, haptics, help | Lab UI |

There is no continuous tilt/gravity-driven film flow in Mobile; shake randomizes settings. A future sensor-to-direction mapping is new work and must submit generic forces/parameters, not DeviceMotion events to the engine.

Correct gesture arbitration during migration: adding a second contact currently stops pointer moves but can leave `ptr.down` and strength active at the previous position. `cancel` calls `up` and can dispatch tap-like actions. Window-level pointermove can also update influence while over controls. Track owned contact ids, suspend/release fluid influences on entering a parameter gesture, ensure cancellation never commits a tap action, and suppress UI-origin movement. Preserve good UX without reproducing these state bugs. Convert real dt-based velocity; do not port Mobile's displacement-as-velocity or raw event thresholds into engine math.

## 11. Presets, palettes, mutation, reset and locks

### Existing behavior

Fixed has seven coherent scenes: Soap Film, Oil Slick, Deep Violet, Electric Cells, Calm Membrane, Chaotic Laboratory and Mother of Pearl. Mobile has the six corresponding scene families plus Chrome Membrane (`chrome`), and five separate palettes: Default, Aurora, Pastel, Neon, Mono. Qwen has six scene families and no independent palette selector. Equal display names do not imply equal parameter sets. Qwen scene presets can also select quality/AA; Fixed's current preset objects omit renderScale and quality despite broad comments about presets.

Fixed mutation selects 7–9 unlocked keys, nudging thickness by up to 90 nm, azimuth 60°, sharpness 40, and others proportionally by up to 28%. Proportional mutation cannot move an exact zero for those other keys. Randomize samples fresh independent safe windows, deliberately preserving resolution; examples include exposure .84–1.24, film base 130–820 nm, ambient .24–.68, and grain .002–.014. This avoids repeated randomization becoming trapped around its previous values.

Qwen mutation touches every numeric parameter except renderScale using 7.5% of its safe span, plus larger spectralSpread/warp/vorticity/lightAz nudges. Randomize uses narrower `SAFE` windows (exposure .75–1.5, thickness .12–.78, ambient .12–.8), preserves renderScale, and intentionally chooses strong cells only 14% of the time; otherwise it biases cell amount toward zero. The nominal random range for renderScale is overridden. Mobile mutation uses 10% or 4.5% of full range, then pulls 10% toward defaults; skips system parameters and enforces the index gap. Randomize uses hand-picked windows (exposure .9–1.3, film thickness .16–1.5 µm scale, ambient .12–.42), preserves system settings and does not randomize temporalSpeed. Neither has locks.

Mobile palettes include exposure, contrast, highlight and ambient as well as spectral/index parameters, yet `PALETTE_PARAM_KEYS` omits those four. Editing them can leave the palette label falsely unchanged. Applying a palette leaves the scene label, although a scene currently includes overlapping optical values. Import/reset semantics also differ: Fixed reset preserves locked numeric values, resets unlocked values then applies Soap Film and preserves quality/MSAA; factory reset clears locks/storage and reinitializes. Qwen resets schema values and render settings; Mobile resets targets to schema defaults, with transitions. These should become named operations with declared scope.

SOL offers useful seeded, family-aware randomization: structural ranges come from the chosen morphology and optics from a preset with bounded perturbations. Its mutation mostly preserves family, occasionally moves to a neighboring family and perturbs the seed. Preserve that deliberate distribution concept, not the arbitrary order of its family menu as a semantic neighborhood.

### Lock implementation and clean boundary

Fixed stores `locks` beside target/current values. Preset/mutate/randomize skip locked keys; callbacks reject direct edits and single resets. Locking snaps current to target so interpolation stops at the chosen value. Imports call snapshot application with live locks preserved, retaining previous target values and the lock set; restoring persisted state can restore saved locks. Locked-skipping preset application marks the scene Custom. Factory reset alone bypasses locks. A renderScale lock restores manual scale and prevents adaptive scale writes. This behavior is wider than disabling a slider.

Recommend a **source-neutral parameter controller in the engine package, around validated parameter commits**, not inside film/shader math. It owns targets, transitions and lock filtering; the engine facade routes every parameter write through it. Lab owns lock widgets, local persistence and factory-reset confirmation UX. Lumison calls the same controller, so music-driven updates honor locks without importing Lab. Keep pure patch generation for presets/mutation separate from applying a patch; this makes seeded generation testable and lock policy consistent.

Lock semantics should preserve Fixed's strict default: manual edits, gestures, sensors, presets, palettes, mutate, randomize, normal reset, imports and future musical modulation all respect locks. Return accepted/skipped/rejected keys. Only an explicit factory-reset operation may clear locks; do not add an easy music-side “force” bypass. Snapshot restore versus importing parameters must remain distinct operations.

Validate cross-parameter constraints after lock filtering. For example, changing film index must not cause an implicit adjustment of a locked substrate index. Reject the incompatible part/transaction with a reason or clamp only an unlocked value according to a documented profile rule. Report partial application honestly. A parameter lock freezes that parameter, not all temporal behavior or incoming ripple events; disabling interaction is a separate setting. Render-scale freeze versus allowing temporary adaptation is an explicit budget policy, defaulting to Fixed's strict behavior.

### Unified preset/palette model

Use versioned data patches with declared key scopes and profile identity:

- Structure preset: field profile, seed policy and simulation parameters; avoid changing optics by default.
- Optical palette: spectral/refraction/absorption and color response, with explicitly declared optional lighting/grade values. A lighting profile can be separate when useful.
- Full scene: composition of structure, optical palette and lighting/grade for faithful historical looks. Application hardware settings are excluded unless explicitly requested.

Keep compatibility scene IDs namespaced by source so “Soap Film” is not an ambiguous import. No silent auto-conversion based on equal names. Keep schema hard limits separate from curated safe sampling ranges and mutation distributions. Allow deterministic seeds and selected scopes, avoid randomizing resolution/AA or interaction defaults through a color action, and use additive spans for zero-valued controls. Derive Custom labels from the patch's actual declared keys and committed values, rather than handwritten incomplete lists.

The engine package may export pure reusable preset/palette patch helpers and example data. The Lab owns catalog display, user collections, descriptions, local storage and action controls, consistent with repository architecture. Lumison can construct parameter patches independently or reuse exported neutral helpers.

## 12. Recommended Golden TFL architecture

Preserve the existing dependency direction:

```text
apps/tfl-lab ────┐
                 ├──> packages/tfl-engine
apps/lumison ────┘
```

Within the engine, use a staged surface pipeline: canonical coordinates → source-neutral displacement influences/events → procedural flow/domain warp → structure/thickness → optical normal surface → spectral material response → lighting → grading/output. Fixed compatibility initially retains its historical order where needed; moving interaction earlier is an explicit behavior addition, not a hidden baseline rewrite.

Keep contracts between stages as quantities (surface position, thickness in nm, normal, optional curvature/cell/debug channels), not legacy packed uniform slots. Keep one authority for parameters, units, clocks and interaction event lifetime. Renderer-specific packing and precision remain private. A dedicated parameter transaction layer keeps locks and transitions out of shader code while preventing different callers from bypassing policy.

Prefer continuous structural weights for cells and separable interaction gains. Retain profile identities for materially different field/optical algorithms. Do not claim that interpolating arbitrary profiles automatically gives meaningful in-between physics; choose explicit transition rules for algorithm changes. Pixel-level compatibility and corrected physical semantics can coexist as named profiles, rather than an accumulating set of undocumented constants.

Preserve diagnostics but correct their meaning: Fixed's Flow view is RGB base/cells/ridge components, not a velocity vector visualization; its CPU probe is an approximate mirror using different hashes and incomplete transforms, not exact GPU thickness. Engine diagnostics should state their accuracy and coordinate convention. New displacement and pre-grade radiance views are essential to judge pull versus recoloring.

## 13. Proposed module ownership

These are proposed responsibilities and paths, not files created by this task.

| Location | Responsibility |
| --- | --- |
| `packages/tfl-engine/src/index.js` | Public facade, creation/disposal, state/config access, step/render boundary |
| `packages/tfl-engine/src/parameters/` | Canonical schema/units, validation, target/current transition state, lock-aware transactions, pure seeded patch generation and version conversion |
| `packages/tfl-engine/src/field/` | Procedural noise/flow/warp, thickness, optional cellular behavior, field profiles |
| `packages/tfl-engine/src/interaction/` | Source-neutral influence state, analytic displacement/shear/radial fields, bounded ripple history, response envelopes |
| `packages/tfl-engine/src/optics/` | Spectral/refraction/absorption response and explicit legacy/corrected profiles |
| `packages/tfl-engine/src/lighting/` | Light directions/rig profiles, normals response, environment/specular composition |
| `packages/tfl-engine/src/rendering/` | Three/TSL material/backend lifecycle, viewport/buffer conversion, optional field targets, output transforms, diagnostics, effective quality budget |
| `packages/tfl-engine/src/profiles/` | Neutral profile definitions and reusable scene/palette patches; no GUI or storage |
| `apps/tfl-lab/src/input/` | Pointer Events, CSS coordinate mapping, multitouch arbitration, device sensors, mapping to neutral controls |
| `apps/tfl-lab/src/ui/` | Parameter panels, lock toggles, quick mobile actions, help, HUD/probe, scene/palette browsing |
| `apps/tfl-lab/src/state/` | UI preferences, persistence/import/export workflow, collection management, orchestration |
| `apps/lumison/src/` | MIDI acquisition, piano/performance interpretation, musical memory, musical-to-visual mappings, its own UI/persistence |

Do not create speculative MIDI/instrument abstractions in the engine. “Note,” “pedal,” “chord,” touch count, pointerType, accelerometer axes, DOM events and CSS controls are absent from its API. A canvas surface and graphics capabilities can enter the renderer; window-size observation and input listeners remain application integration.

## 14. Proposed conceptual TFL Engine API

This is an API sketch in prose, not implementation or a final naming commitment.

| Operation | Contract and reason |
| --- | --- |
| `createEngine(surface, configuration)` | Async renderer initialization; explicit viewport/pixel ratio, baseline profile, deterministic seed and budget. Returns capabilities/backend or a diagnosable failure |
| `setParameters(patch, transition)` / single-key convenience | Validate finite values/units, filter locks, enforce compatible constraints and commit targets atomically; report applied/skipped/rejected keys |
| `getParameters({target or current})`, schema access | Separate requested and smoothed values; expose semantic ranges for both apps |
| `setLocks(keys)` / inspect locks | Source-neutral strict parameter policy, with behavior documented in section 11 |
| `applyScene(patch)` / `applyPalette(patch)` | Scoped patch application through the same transaction path; optional pure catalog helpers resolve an ID to data. No UI/storage access |
| `mutate({scope, amount, seed})`, `randomize({scope, profile, seed})` | Generate curated patches and apply through the controller; never arbitrary shader uniform writes |
| `resetParameters(scope)` | Restore unlocked defaults/scene defaults under a clearly selected reset scope; full state/lock reset is explicit and separate |
| `updateInfluence(id, descriptor)` / `releaseInfluence(id)` | Continuous radial/tangential/velocity displacement and optional thickness/emission, position/radius in surface units, release envelope; no mouse/button semantics |
| `emitRipple(descriptor)` | Timed, bounded event with independent displacement/thickness/light gains; inactive-first allocation, defined oldest-event eviction |
| `clearInteractions()` | Explicit stop/cleanup; does not alter scene parameters |
| `advance(dt)` / `render()` | Explicit deterministic clock progression, distinct flow/light/event time; application may use rAF without making it part of field math |
| `setPlayback(configuration)` | Define global rate, animation pause and interaction-freeze policy; avoid inheriting contradictory pause behaviors |
| `resize(viewport)` / `setRenderBudget(configuration)` | Requested size/quality separately from effective size/work; activity hints optional and source-neutral |
| `getDiagnostics()` / `setDiagnosticView(view)` | Field/backend stats and known accuracy; distinguish submission time from GPU duration |
| `snapshot()` / validated restore | Versioned engine state/config, seed, locks and clock policy; transient effects only if explicitly requested; no localStorage calls |
| `dispose()` | Release graphics resources and pending work; input listener cleanup belongs to adapters |

A Lab hover can submit an influence with displacement gain zero or a low velocity gain. A held drag uses a different descriptor and can emit distance-spaced ripples. A phone sensor mapper can generate a parameter patch or spatial event. Lumison can map an interpreted musical event to a positioned ripple or envelope without passing MIDI data to the engine. Mechanism configuration, event count bounds and response times belong to shared visual behavior; interpretation of which event should happen belongs to the application.

Do not expose `setPointerField` as the central abstraction: it unnecessarily describes a source. Do not expose raw backend uniforms. Explicit snapshots and fixed-step/event replays should support repeatable review; archival prototypes remain external references.

## 15. Risks and unknowns

- Perceptual pull and recovery require browser evaluation at matching canvas sizes and input paths. Spatial displacement in code alone does not guarantee convincing motion, especially with large color variation.
- Exact Fixed output depends on bundled Three revision, output transform and GPU backend. Pin its provenance/version during implementation; do not upgrade dependencies while establishing fidelity.
- Domain noise, nominal thickness, spread, tension, light axes and phase conventions conflict. A universal rename-and-clamp importer will silently change scenes.
- Fixed normals intentionally differ from color thickness; Qwen omits ripple addition from derivatives; Mobile's normals vary with resolution. Correcting them may improve coherence while changing cherished appearance.
- Mobile's extra π phase combined with signed interface amplitudes should be reviewed as an optical convention; preserving a legacy look and improving physical accuracy are separate acceptance targets.
- Mobile WGSL one-tap `shadeAA` still applies a negative thickness offset, whereas GLSL explicitly uses zero when one tap is selected. Backends are not exactly identical even before precision differences.
- Mobile float texture fallback clips raw values; Canvas normalizes reflected luminance away. These are separate backend-specific defects, not global exposure defaults.
- Qwen ripple allocation and Aggressive array/loop mismatch require correction before using their event capacity as evidence of working behavior. No compile or device-specific failure is asserted without a run.
- Adaptive scale changes can change field derivatives, structure detail and spectral color. Maintain requested versus effective configuration and reproducible capture settings.
- Mobile's scale propagation and Qwen's demanding recovery thresholds can keep a scene degraded; Aggressive can resize often or fail to fully settle. Device traces are necessary before enabling them.
- GPU resource/context loss and late initialization need cleanup and fresh context handling. A Canvas fallback should declare unsupported features rather than claim engine parity.
- The new repository check only syntax-checks the three placeholder entry points. It provides no validation of archived shaders or this plan's visual hypotheses.
- License/provenance and exact dependency pinning must be checked before any later extraction. This task performs no dependency installation or implementation reuse.

## 16. Things that must not be merged blindly

1. Whole historical HTML applications, global state objects, UI callbacks, localStorage helpers or browser event listeners into `tfl-engine`.
2. Raw pointer uniforms with different coordinate origins, aspect factors, y directions and velocity units.
3. Thickness-only “shear” or glow as proof of spatial deformation; also do not remove Fixed's existing deformation based on the initial assumption that it has none.
4. Mobile's sustained hover as the default, or SOL's fast-hover ripple spawning as an unconditional engine behavior.
5. Qwen's faulty ripple slot selection, Aggressive's six-iteration/four-element mismatch, or quality settings that shorten interaction history without explicit choice.
6. Mobile's reflection gain, `gChroma` multiplier, transmission/backlight, normal multiplier, ACES and gamma as one inseparable package.
7. A second gamma/tone transform on top of Three output, or identical exposure defaults across incompatible optical profiles.
8. The three meanings of spectral spread, the opposing meanings of tension, or numeric film-thickness values without semantic conversion.
9. Always-on F1 cells as an implementation of optional Qwen F2−F1 cells; zero cellular amount must actually suppress the new contribution.
10. Performance tiers under identical names while changing spectrum, octaves, normals or scene intent; do not apply Aggressive thresholds to every user.
11. RGBA8 storage of unencoded >1 field quantities, CPU fallbacks as visual gold standards, or CPU submission timing labeled as GPU execution time.
12. Palette label tracking that excludes keys the palette actually writes; scene selection that silently resets quality, locks or mobile preferences.
13. Parameter writes from future music mappings that bypass locks, validation or transitions; implicit index corrections that modify a locked value.
14. Gesture cancellation dispatched as a tap, stale single-contact influence during multitouch, or window pointer moves over UI affecting the artwork.
15. SOL's six morphology branches, a persistent fluid solver, a major new framework, or instrument class hierarchies before their value is demonstrated and separately scoped.

## 17. Exact staged migration order and exit criteria

The following work is proposed for subsequent implementation tasks. **This task ends after committing this document.** Each phase should be independently reviewable and retain the preceding baseline; do not proceed past a failed visual/behavior gate by changing defaults to hide it.

### Phase 1 — Establish evidence and preserve Fixed

1. Record the archived Fixed dependency revision, baseline scenes, quality, backend/output settings, viewport and clocks. Capture Fixed and primary-reference interaction replays without editing the archive; keep future harness/results outside `tmp/`.
2. In a separately authorized implementation task, establish Fixed's renderer/field behavior in the intended directories, with Lab UI/input outside the engine. Make its existing Three/TSL dependency explicit and pinned; add no major framework.
3. Preserve numeric controls, locks, scene transitions, diagnostics, no-hover default and fallback labeling before improving behavior. Characterize WebGPU/WebGL2 and Canvas separately.

**Exit:** Fixed scenes match recorded output under fixed settings; basic click/drag/lock/preset/reset/import behavior is characterized. `tmp/` unchanged. Any known fallback differences are visible in capabilities, not hidden.

### Phase 2 — Canonical state, coordinates and control boundary

1. Introduce canonical surface coordinates, nm units, separate requested/current/effective state and a shared lock-aware transaction path while keeping Fixed compatibility transformations.
2. Establish explicit flow/light/event clocks, deterministic seeds, pause semantics and replayable input events. Preserve legacy phase behavior in compatibility where needed; introduce continuous-rate clocks as a documented change.
3. Add influence/event storage with finite bounds, inactive-first allocation and documented eviction. Add displacement/normal/field diagnostics before porting visual mechanisms.

**Exit:** Existing Fixed replays still pass; portrait/landscape/CSS-scaled coordinate tests align on both GPU backends; zero input, invalid parameters, locked imports, cross-index constraints and pause/release contracts have focused tests. Two apps can use the neutral control boundary without importing each other.

### Phase 3 — Spatial interaction superset

1. Port Qwen's passive velocity displacement independently, leaving passive gain zero by default. Demonstrate movement of unlit structural landmarks without thickness/light additions.
2. Add active radial press, active velocity gain and separately adjustable coordinate shear if demonstrated necessary. Preserve Fixed scalar shear only as a named thickness response.
3. Add aged ripple displacement independently from ripple thickness/emission; correct the historical allocator/capacity issues.
4. Add Mobile's broad radial/tangential influence and wave-front/recovery envelopes. Reconcile normal sampling with displaced structure, retaining the explicit Fixed normal profile.

**Exit:** Off, passive-only, click, active drag, shear and ripple behavior can be exercised independently; release recovers predictably at different frame rates. Multiple events remain at their original locations. Pull remains visible with interference/glow disabled. Assess whether a persistent solver is necessary only after this gate.

### Phase 4 — Structural variety without replacing Fixed

1. Add Qwen's animated F1/F2 plate/border behavior and continuous cellular amount, including a true off state; calibrate thickness separately from Fixed's implicit F1.
2. Retain Qwen flow/noise profile differences needed for its large organic structures; add Mobile's 3D evolving field profile if the interaction envelope alone does not preserve its visual behavior.
3. Evaluate SOL's seeded family-aware controls and filament/marbling examples as optional follow-on scope, not mandatory branch imports.

**Exit:** Fixed remains available, Qwen cells can be disabled completely, intermediate cellular states behave continuously, and reference organic/membrane structures are recognizably preserved. Matching concerns are documented with images rather than resolved by forcing one field everywhere.

### Phase 5 — Optical profiles and color calibration

1. Instrument reflection, transmission, normals, diffuse, specular, Fresnel, emission and pre-output radiance.
2. Perform the Mobile ablations from section 7 and verify Three output conversion. Correct backend-specific normalization/AA errors in new code only.
3. Add index/absorption capabilities and explicit spectral-response semantics; preserve Fixed dark appearance as the default profile while retaining selectable softer/Qwen optical profiles.
4. Separate highlight/diffuse strength, normal strength and interaction emission from geometry; calibrate canonical thickness and grade ranges.

**Exit:** Deep/dark, organic/cellular and soft membrane scenes coexist. Exposure is a predictable gain, palettes do not unexpectedly change structure, GPU output has one intended display transform, and white-pixel/chroma diagnostics support the chosen defaults.

### Phase 6 — Rendering efficiency and resilience

1. Benchmark baseline workloads and evaluate Mobile's cached two-pass field against current single-pass TSL cost and visual output. Adopt only with measurable benefit and correctly encoded field formats.
2. Keep Fixed scale-only adaptation as the default. Add source-neutral activity-aware resolution as an optional budget policy with settle hysteresis and guaranteed restoration.
3. Consider cheaper octaves/spectral work only as explicit economy profiles; do not import Aggressive code unchanged. Complete backend/context-loss cleanup and truthful fallback capabilities.

**Exit:** Sustained frame-time/memory traces on desktop and mobile demonstrate benefit without unwanted hue/normal popping; manual settings, locks and capture mode remain stable; fallback/recovery and no-float cases behave as declared.

### Phase 7 — Mobile adapters and Lab UX

1. Add pointer/touch contact arbitration, pinch and translation gestures on top of the neutral transaction/influence API.
2. Add tap/hold/rail commands and mobile quick controls/help. Cancellation, UI-origin events and contact-count changes cannot accidentally commit actions or leave stale forces.
3. Add opt-in sensor integration and shake-to-randomize, permission/no-data handling and haptics in Lab. Preserve reduced-motion preferences as app policy.

**Exit:** Actual touch devices validate one-, two- and three-contact interactions, sensor availability/failure, rotation/resizing and UI restoration; no browser input semantics enter the engine.

### Phase 8 — Unified catalogs, generative controls and final regression

1. Convert historical scene data through explicit versioned mappings into structure/optical/full-scene patches, retaining source identity and compatibility profiles.
2. Expose shared seeded mutate/randomize helpers with scope-specific safe ranges; integrate palette and lock controls consistently. Keep device settings outside normal visual randomization.
3. Verify ordinary reset versus factory reset, import versus restore, exact Custom labeling, locks during transitions and mock source-neutral musical control. Lumison's actual MIDI/music implementation remains a separate task.
4. Run the full matrix of scene appearance, independent interactions, portrait/landscape, backends, quality budgets, persistence and reduced motion; document remaining deliberate compatibility differences.

**Exit:** One engine supports the useful capabilities of all primary references, both applications can control it independently, and Golden TFL acceptance rests on preserved scenes and repeatable behavior rather than selecting a single surviving prototype.
