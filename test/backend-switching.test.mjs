import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeRequestedBackend } from '../packages/tfl-engine/src/renderer.js';
import { createBrowserRenderHost } from '../packages/tfl-engine/src/browser.js';

test('backend requests distinguish automatic startup from explicit selection', () => {
  assert.equal(normalizeRequestedBackend(), 'auto');
  for (const backend of ['auto', 'WebGPU', 'WebGL2']) {
    assert.equal(normalizeRequestedBackend(backend), backend);
  }
  for (const invalid of [null, '', 'webgpu', 'WebGL', 'Canvas2D']) {
    assert.throws(() => normalizeRequestedBackend(invalid), /Unknown GPU backend/);
  }
});

test('invalid, automatic and concurrent switch requests preserve the active host', async () => {
  const canvas = {};
  const host = createBrowserRenderHost({ canvas, fallbackCanvas: {} });
  const renderer = {};
  const stage = {};
  Object.assign(host, { backend: 'WebGL2', renderer, stage });
  const options = { msaa: 0, quality: 'High' };
  assert.equal(await host.switchBackend('WebGL2', options), canvas);
  await assert.rejects(host.switchBackend('invalid', options), /Unknown GPU backend/);
  await assert.rejects(host.switchBackend('auto', options), /Choose WebGPU or WebGL2/);
  host.switching = true;
  await assert.rejects(host.switchBackend('WebGPU', options), /already in progress/);
  assert.equal(host.backend, 'WebGL2');
  assert.equal(host.renderer, renderer);
  assert.equal(host.stage, stage);
  assert.equal(host.canvas, canvas);
  assert.equal(host.backendChange, null);
});

test('MSAA changes rebuild the same backend and failure preserves the active configuration', async () => {
  let replacements = 0;
  const canvas = {
    cloneNode() {
      replacements++;
      throw new Error('Replacement unavailable');
    },
  };
  const host = createBrowserRenderHost({ canvas, fallbackCanvas: {} });
  const renderer = {};
  const stage = {};
  Object.assign(host, { backend: 'WebGPU', renderer, stage, msaa: 2 });
  assert.equal(await host.switchBackend('WebGPU', { msaa: 2, quality: 'High' }), canvas);
  assert.equal(replacements, 0);
  for (const msaa of [0, 4]) {
    await assert.rejects(
      host.switchBackend('WebGPU', { msaa, quality: 'High' }),
      /Replacement unavailable/,
    );
    assert.equal(host.msaa, 2);
    assert.equal(host.renderer, renderer);
    assert.equal(host.stage, stage);
    assert.equal(host.canvas, canvas);
    assert.equal(host.backend, 'WebGPU');
    assert.equal(host.switching, false);
  }
  assert.equal(replacements, 2);
});
