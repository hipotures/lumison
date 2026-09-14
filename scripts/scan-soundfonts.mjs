import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSoundFontCatalog } from './lib/soundfont-catalog.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const soundfontDirectory = path.join(repositoryRoot, 'apps/lumison/assets/soundfonts');
const catalog = createSoundFontCatalog(
  await readdir(soundfontDirectory, { withFileTypes: true }),
);

const catalogPath = path.join(soundfontDirectory, 'catalog.json');
await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
console.log(`SoundFont catalog: ${catalog.length} entr${catalog.length === 1 ? 'y' : 'ies'}`);
