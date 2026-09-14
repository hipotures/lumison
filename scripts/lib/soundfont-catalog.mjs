const supportedExtension = /\.(?:sf2|sf3|dls)$/i;

function compareNames(left, right) {
  const foldedLeft = left.toLowerCase();
  const foldedRight = right.toLowerCase();
  if (foldedLeft < foldedRight) return -1;
  if (foldedLeft > foldedRight) return 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

function safeFilename(filename) {
  return filename.length <= 255 && !/[\u0000-\u001f\u007f]/.test(filename);
}

function displayName(filename) {
  return filename
    .replace(supportedExtension, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function baseId(filename) {
  return displayName(filename)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'soundfont';
}

export function createSoundFontCatalog(directoryEntries) {
  const filenames = directoryEntries
    .filter((entry) => entry.isFile()
      && safeFilename(entry.name)
      && supportedExtension.test(entry.name))
    .map((entry) => entry.name)
    .sort(compareNames);
  const usedIds = new Set();
  return filenames.map((file) => {
    const base = baseId(file);
    let id = base;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${base}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);
    return { id, name: displayName(file), file };
  });
}
