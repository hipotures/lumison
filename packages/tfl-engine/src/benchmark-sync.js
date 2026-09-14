// WebGL completion polling yields a browser task before every zero-timeout
// query. Only one batch may be outstanding; no blocking finish/busy-wait.
export async function waitForWebGLCompletion(gl, {
  signal,
  timeoutMs = 5000,
  now = () => performance.now(),
  yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 0)),
} = {}) {
  const check = () => {
    if (signal?.aborted) throw new DOMException('Benchmark cancelled', 'AbortError');
    if (gl.isContextLost()) throw new Error('WebGL2 context lost');
  };
  check();
  const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (!fence) throw new Error('WebGL2 completion fence unavailable');
  const started = now();
  try {
    gl.flush();
    while (true) {
      await yieldToBrowser();
      check();
      if (now() - started >= timeoutMs) throw new Error('GPU completion timed out');
      const status = gl.clientWaitSync(fence, 0, 0);
      if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) return;
      if (status !== gl.TIMEOUT_EXPIRED) throw new Error('WebGL2 completion wait failed');
    }
  } finally {
    gl.deleteSync(fence);
  }
}
