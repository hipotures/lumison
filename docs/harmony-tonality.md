# Harmony / Tonality

This optional subgroup adds slow tonal character changes in Lumison. Analysis
defaults on for diagnostics; every tonal visual mapping defaults off with zero
amount and zero master influence. The pre-existing Musical Field v1 engine-call
trace remains unchanged. No audio, scheduling, or TFL engine code is involved.

## Analysis

`music/tonality.js` uses the 12 major and 12 minor Krumhansl–Kessler profiles and
Krumhansl–Schmuckler Pearson matching, documented in the
[Humdrum keycor reference](https://extra.humdrum.org/man/keycor/). Profile matching
is an estimate, especially for ambiguous relative keys or non-tonal music.

An independent replay of the existing PerformanceState supplies sounding durations,
including pedal-held notes. Channel 10 is excluded. Within each time segment,
each pitch class contributes the maximum voice weight `0.75 + 0.25 * velocity`;
doubling octaves/unisons and repeating attacks add no count bonus. Prefix duration
integrals provide the trailing local histogram without rescanning notes per frame.

Confidence is positive Pearson correlation, **not a calibrated probability**.
Score separation is half the difference between the top two correlations. Fewer
than four materially represented pitch classes, less than two weighted pitch-class
seconds, or separation below 0.01 yields unknown. These conservative evidence gates
and the stability policy are application choices, separate from the K-S method.

Key signatures are timestamped metadata; canonical playback events are unchanged.
The metadata key receives a bounded correlation preference (default 0.08). Stronger
conflicting evidence overrides it; the UI always retains separate inferred and
metadata diagnostics. Metadata alone cannot make insufficient note evidence certain.

Analysis uses a fixed 250 ms grid, a 12 s trailing window, minimum correlation 0.65,
and a 0.08 challenger margin. A proposed change must last 3 s. Low confidence holds
the last key by default; disabling Hold key allows unknown after the stable time.
Window, threshold, margin, stable time, metadata preference and hold policy are tunable.
Seek/loop replay the deterministic analysis grid directly to the destination, so
skipped historical keys are never sent as successive visual transitions. This replay
is linear in elapsed analysis ticks; it does not reconstruct or restart audio.

## Visual composition

Tonic coordinates are `(cos(theta), sin(theta))`, where `theta = 2π * ((7*pc) mod 12)/12`.
Adjacent fifths lie next to each other; opposite fifths are farthest apart. Each tonic
target projects these coordinates onto its tunable phase, multiplied by a signed
amount and master tonal influence. Mode uses +1/-1 for major/minor, with zero default
amounts and no fixed brightness rule. These are explicit mapping choices, not part
of the key detector.

Tonic targets: filmBase, flowScale, interf, spread, azimuth. Mode targets: thickVar,
tension, saturation, contrast. Each has Enabled, signed Amount, and Solo; tonic
targets also expose phase. Solo enables analysis and the regime carrier, preserves
numeric settings, and disables other visual mappings. Set influence and amount
above zero (or use a negative amount) to observe an initially neutral Solo.

Tonal offsets transition with cubic smoothstep, reaching the exact target after the
configured duration (default 5 s). Interrupted transitions start from their current
value. Disabled or zero controls remove only their contribution immediately. Unknown
keys transition toward zero. Seek defaults to the reconstructed offset immediately;
an optional short seek transition is available.

The mapper composes `baseline + musical offset + tonal offset * master sensitivity`
and clamps once through the public parameter schema. Thus register and tonic share
filmBase additively; no setter overwrites the other. Baselines are captured from the
selected startup visual state. Newly controlled tonal targets restore to that baseline
when disabled; no preset changes, transient events or renderer rebuilds occur.

## Configuration

JSON version 2 adds `harmony.analysis` and `harmony.mapping`. Mapping contains enabled,
influence, transitionSeconds, seekTransitionSeconds, and targets keyed by stable TFL
parameter names, each with enabled/amount and (for tonic) phaseDegrees. Detector
history, confidence, keys, audio state and file data are not serialized. Version 1
imports migrate with neutral harmony defaults; invalid imports remain atomic.
