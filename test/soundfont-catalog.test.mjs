import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isSupportedSoundFontName,
  parseSoundFontCatalog,
  soundFontAssetUrl,
} from '../apps/lumison/src/audio/soundfont-catalog.js';
import { createSoundFontCatalog } from '../scripts/lib/soundfont-catalog.mjs';

test('SoundFont catalog validates supported app-hosted files', () => {
  const catalog = parseSoundFontCatalog([
    { id: 'grand-piano', name: 'Grand Piano', file: 'Grand Piano.sf2' },
    { id: 'compact-gm', name: 'Compact GM', file: 'compact.sf3' },
    { id: 'legacy-dls', name: 'Legacy DLS', file: 'legacy.DLS' },
  ]);
  assert.equal(catalog.length, 3);
  assert.equal(isSupportedSoundFontName('local.sf2'), true);
  assert.equal(soundFontAssetUrl(catalog[0], 'https://example.test/soundfonts/').href,
    'https://example.test/soundfonts/Grand%20Piano.sf2');
});

test('SoundFont catalog rejects unsupported extensions and unsafe paths', () => {
  for (const file of [
    '../secret.sf2',
    'nested/bank.sf2',
    'nested\\bank.sf2',
    'bank.wav',
    'bank.sf2\u0000.txt',
  ]) {
    assert.equal(isSupportedSoundFontName(file), false, file);
    assert.throws(() => parseSoundFontCatalog([
      { id: 'unsafe', name: 'Unsafe', file },
    ]), TypeError);
  }
  assert.throws(() => parseSoundFontCatalog([
    { id: 'bad path', name: 'Bad ID', file: 'okay.sf2' },
  ]), TypeError);
  assert.throws(() => parseSoundFontCatalog([
    { id: 'same', name: 'One', file: 'one.sf2' },
    { id: 'same', name: 'Two', file: 'two.sf2' },
  ]), TypeError);
});

test('development catalog discovery is deterministic and ignores unsupported entries', () => {
  const file = (name, regular = true) => ({ name, isFile: () => regular });
  assert.deepEqual(createSoundFontCatalog([
    file('Zebra.dls'),
    file('Piano Infinity.sf2'),
    file('notes.txt'),
    file('alpha_bank.SF3'),
    file('nested.sf2', false),
  ]), [
    { id: 'alpha-bank', name: 'alpha bank', file: 'alpha_bank.SF3' },
    { id: 'piano-infinity', name: 'Piano Infinity', file: 'Piano Infinity.sf2' },
    { id: 'zebra', name: 'Zebra', file: 'Zebra.dls' },
  ]);
});
