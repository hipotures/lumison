const SUPPORTED_SOUNDFONT_EXTENSION = /\.(?:sf2|sf3|dls)$/i;
const SAFE_ID = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/i;

export const SOUNDFONT_CATALOG_URL = new URL(
  '../../assets/soundfonts/catalog.json',
  import.meta.url,
);

export const SOUNDFONT_ASSET_URL = new URL('../../assets/soundfonts/', import.meta.url);

export function isSupportedSoundFontName(filename) {
  return typeof filename === 'string'
    && filename.length > 0
    && filename.length <= 255
    && filename !== '.'
    && filename !== '..'
    && !filename.includes('/')
    && !filename.includes('\\')
    && !/[\u0000-\u001f\u007f]/.test(filename)
    && SUPPORTED_SOUNDFONT_EXTENSION.test(filename);
}

export function parseSoundFontCatalog(value) {
  if (!Array.isArray(value)) throw new TypeError('SoundFont catalog must be an array');
  const ids = new Set();
  const files = new Set();
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new TypeError('SoundFont catalog entries must be objects');
    }
    const { id, name, file } = entry;
    if (typeof id !== 'string' || !SAFE_ID.test(id)) {
      throw new TypeError(`Invalid SoundFont catalog id: ${String(id)}`);
    }
    if (typeof name !== 'string' || !name.trim() || name.length > 160
      || /[\u0000-\u001f\u007f]/.test(name)) {
      throw new TypeError(`Invalid SoundFont catalog name for ${id}`);
    }
    if (!isSupportedSoundFontName(file)) {
      throw new TypeError(`Invalid SoundFont catalog file for ${id}`);
    }
    const foldedFile = file.toLowerCase();
    if (ids.has(id) || files.has(foldedFile)) {
      throw new TypeError(`Duplicate SoundFont catalog entry: ${id}`);
    }
    ids.add(id);
    files.add(foldedFile);
    return Object.freeze({ id, name: name.trim(), file });
  });
}

export async function loadSoundFontCatalog({
  fetchImpl = globalThis.fetch,
  catalogUrl = SOUNDFONT_CATALOG_URL,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch is unavailable');
  const response = await fetchImpl(catalogUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error(`SoundFont catalog request failed (${response.status})`);
  return parseSoundFontCatalog(await response.json());
}

export function soundFontAssetUrl(entry, baseUrl = SOUNDFONT_ASSET_URL) {
  const [validated] = parseSoundFontCatalog([entry]);
  return new URL(encodeURIComponent(validated.file), baseUrl);
}
