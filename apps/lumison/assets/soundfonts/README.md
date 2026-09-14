# Lumison SoundFonts

Place local `.sf2`, `.sf3`, or `.dls` sound banks in this directory. The Lumison
development server discovers them on every page refresh, without a restart.

For static hosting, generate `catalog.json` explicitly:

```sh
npm run soundfonts:scan
```

Sound bank binaries are ignored by Git. `catalog.json` is committed empty so a
checkout without local banks still works.

You can also load a bank for the current browser session with **Load local
SoundFont...**; that reads the file locally and does not upload it.
