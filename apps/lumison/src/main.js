import { createState, TflEngine } from '../../../packages/tfl-engine/src/index.js';
import { createBrowserRenderHost } from '../../../packages/tfl-engine/src/browser.js';
import { MidiFilePlayer } from './midi/midi-file-player.js';
import { WebMidiSource } from './midi/web-midi-source.js';

const element = (id) => document.getElementById(id);
const bootMessage = (message) => { element('bootMsg').textContent = message; };

function formatTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = (safe % 60).toFixed(2).padStart(5, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}`
    : `${String(minutes).padStart(2, '0')}:${secs}`;
}

function noteName(note) {
  if (!Number.isInteger(note)) return '—';
  const names = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  return `${names[note % 12]}${Math.floor(note / 12) - 1}`;
}

function pedalText(pedal) {
  return pedal.rawValue > 0 ? `${pedal.rawValue} / ${pedal.on ? 'on' : 'off'}` : 'off';
}

function createMidiUI() {
  const player = new MidiFilePlayer();
  const liveSource = new WebMidiSource();
  let scrubbing = false;
  let dirty = true;

  for (let channel = 1; channel <= 16; channel += 1) {
    element('liveChannel').append(new Option(String(channel), String(channel)));
  }

  function render() {
    const state = player.performance;
    const transport = player.transport;
    const metadata = player.metadata;
    const loaded = Boolean(metadata);
    const current = transport.position;
    const total = metadata?.duration ?? 0;

    element('play').disabled = !loaded || transport.playing;
    element('pause').disabled = !loaded || !transport.playing;
    element('stop').disabled = !loaded;
    element('timeline').disabled = !loaded;
    element('speed').disabled = !loaded;
    element('loop').disabled = !loaded;
    if (!scrubbing) element('timeline').value = String(current);
    element('timeline').max = String(total);
    element('timeDisplay').textContent = `${formatTime(current)} / ${formatTime(total)}`;

    element('tempo').textContent = `${Number.isInteger(state.currentTempo)
      ? state.currentTempo : state.currentTempo.toFixed(1)} BPM`;
    element('lastAttack').textContent = state.lastAttackNote === null
      ? '—' : `${noteName(state.lastAttackNote)} / ${state.lastAttackNote}`;
    element('velocity').textContent = state.lastAttackNote === null
      ? '—' : state.lastAttackVelocity.toFixed(2);
    element('keysHeld').textContent = String(state.heldPolyphony);
    element('soundingNotes').textContent = String(state.soundingPolyphony);
    element('noteRange').textContent = state.lowestSoundingNote === null
      ? '—'
      : `${noteName(state.lowestSoundingNote)}–${noteName(state.highestSoundingNote)}`;
    element('sustain').textContent = pedalText(state.sustain);
    element('soft').textContent = pedalText(state.soft);
    element('sostenuto').textContent = pedalText(state.sostenuto);

    element('trackCount').textContent = metadata ? String(metadata.tracks) : '—';
    const names = metadata?.trackNames.join(', ') || '—';
    element('trackNames').textContent = names;
    element('trackNames').title = names === '—' ? '' : names;
    element('channels').textContent = metadata
      ? (metadata.channels.join(', ') || '—') : '—';
    element('eventCount').textContent = metadata
      ? metadata.eventCount.toLocaleString() : '—';
    element('duration').textContent = metadata ? formatTime(metadata.duration) : '—';
    element('sourceStatus').classList.toggle('ready', loaded);
    element('sourceStatus').title = loaded ? 'MIDI file ready' : 'No MIDI file loaded';
    dirty = false;
  }

  player.subscribe(() => { dirty = true; });

  async function loadFile(file) {
    if (!file) return;
    if (!/\.midi?$/i.test(file.name)) {
      element('fileName').textContent = 'Choose a .mid or .midi file';
      return;
    }
    element('fileName').textContent = `Loading ${file.name}…`;
    try {
      player.load(await file.arrayBuffer(), file.name);
      element('fileName').textContent = file.name;
      element('fileName').title = file.name;
      render();
    } catch (error) {
      console.error('MIDI file load failed:', error);
      element('fileName').textContent = 'Could not read MIDI file';
      element('fileName').title = error?.message ?? String(error);
    }
  }

  element('openFile').addEventListener('click', () => element('fileInput').click());
  element('fileInput').addEventListener('change', (event) => {
    loadFile(event.target.files?.[0]);
    event.target.value = '';
  });
  element('play').addEventListener('click', () => player.play());
  element('pause').addEventListener('click', () => player.pause());
  element('stop').addEventListener('click', () => player.stop());
  element('speed').addEventListener('change', (event) => player.setRate(Number(event.target.value)));
  element('loop').addEventListener('change', (event) => player.setLoop(event.target.checked));
  element('timeline').addEventListener('pointerdown', () => { scrubbing = true; });
  element('timeline').addEventListener('input', (event) => {
    player.seek(Number(event.target.value));
    dirty = true;
  });
  for (const eventName of ['pointerup', 'pointercancel', 'change']) {
    element('timeline').addEventListener(eventName, () => { scrubbing = false; });
  }

  const drop = element('fileDrop');
  for (const eventName of ['dragenter', 'dragover']) {
    drop.addEventListener(eventName, (event) => {
      event.preventDefault();
      drop.classList.add('dragging');
    });
  }
  for (const eventName of ['dragleave', 'drop']) {
    drop.addEventListener(eventName, (event) => {
      event.preventDefault();
      drop.classList.remove('dragging');
    });
  }
  drop.addEventListener('drop', (event) => loadFile(event.dataTransfer?.files?.[0]));

  function setMode(mode) {
    const live = mode === 'live';
    if (live) player.pause();
    element('fileMode').hidden = live;
    element('liveMode').hidden = !live;
    element('fileTab').classList.toggle('active', !live);
    element('liveTab').classList.toggle('active', live);
    element('fileTab').setAttribute('aria-selected', String(!live));
    element('liveTab').setAttribute('aria-selected', String(live));
  }
  element('fileTab').addEventListener('click', () => setMode('file'));
  element('liveTab').addEventListener('click', () => setMode('live'));
  element('liveChannel').addEventListener('change', (event) => {
    liveSource.selectChannel(event.target.value === 'all' ? 'all' : Number(event.target.value));
  });

  window.addEventListener('keydown', (event) => {
    if (event.code !== 'Space' || event.repeat) return;
    if (['INPUT', 'SELECT', 'BUTTON'].includes(event.target?.tagName)) return;
    event.preventDefault();
    if (player.transport.playing) player.pause();
    else player.play();
  });

  render();
  return {
    update() {
      player.update();
      if (dirty) render();
    },
  };
}

async function boot() {
  const reduceMotion = typeof matchMedia === 'function'
    && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const state = createState({ reduceMotion });
  const canvas = element('stage');
  const fallbackCanvas = element('fallback2d');
  const renderHost = createBrowserRenderHost({ canvas, fallbackCanvas });
  const engine = new TflEngine({
    renderHost,
    state,
    onBackendChange: ({ backend, fallback, reason }) => {
      renderHost.canvas.hidden = fallback;
      fallbackCanvas.hidden = !fallback;
      element('renderStatus').textContent = fallback ? reason : `Visual renderer: ${backend}`;
    },
  });
  engine.applyPreset('Soap Film', { transition: 'immediate' });
  const midi = createMidiUI();

  const observer = new ResizeObserver(() => engine.resize());
  observer.observe(document.body);
  window.addEventListener('orientationchange', () => engine.resize());

  bootMessage('Initializing TFL renderer…');
  await engine.initialize({ onProgress: bootMessage });
  element('boot').classList.add('done');

  let lastFrame = performance.now();
  const frame = (now) => {
    let delta = (now - lastFrame) / 1000;
    lastFrame = now;
    if (!(delta >= 0) || delta > 0.25) delta = 0.025;
    if (!document.hidden) {
      // TFL advances from its animation delta; MIDI reads its own monotonic
      // transport clock and remains independently pausable/seekable/rateable.
      engine.advance(delta);
      engine.render({ now, displayHz: 60 });
      midi.update();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

boot().catch((error) => {
  console.error(error);
  bootMessage(`Startup failed: ${error?.message ?? error}`);
});
