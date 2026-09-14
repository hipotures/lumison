function clampPosition(position, duration) {
  if (!(typeof position === 'number' && Number.isFinite(position))) return 0;
  return Math.max(0, Math.min(duration, position));
}

function upperBoundByTime(events, position) {
  let low = 0;
  let high = events.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (events[middle].timestamp <= position) low = middle + 1;
    else high = middle;
  }
  return low;
}

export class MidiTransport {
  constructor({
    now = () => performance.now() / 1000,
    onEvents = () => {},
    onChange = () => {},
  } = {}) {
    this.now = now;
    this.onEvents = onEvents;
    this.onChange = onChange;
    this.events = [];
    this.duration = 0;
    this.position = 0;
    this.rate = 1;
    this.loop = false;
    this.playing = false;
    this.cursor = 0;
    this.anchorTime = 0;
    this.anchorPosition = 0;
  }

  setTimeline(events, duration) {
    this.events = events;
    this.duration = Math.max(0, Number(duration) || 0);
    this.playing = false;
    this.position = 0;
    this.anchorPosition = 0;
    this.cursor = 0;
    this.onChange({ type: 'load', position: 0 });
  }

  play() {
    if (!this.events.length || this.playing) return false;
    if (this.position >= this.duration) {
      this.position = 0;
      this.anchorPosition = 0;
      this.cursor = 0;
      this.onChange({ type: 'stop', position: 0 });
    }
    this.anchorTime = this.now();
    this.anchorPosition = this.position;
    this.playing = true;
    this.onChange({ type: 'play', position: this.position });
    return true;
  }

  pause() {
    if (!this.playing) return false;
    const wallTime = this.now();
    this.tick(wallTime);
    this.playing = false;
    this.anchorPosition = this.position;
    this.anchorTime = wallTime;
    this.onChange({ type: 'pause', position: this.position });
    return true;
  }

  stop() {
    this.playing = false;
    this.position = 0;
    this.anchorPosition = 0;
    this.cursor = 0;
    this.onChange({ type: 'stop', position: 0 });
  }

  seek(position) {
    const next = clampPosition(position, this.duration);
    this.position = next;
    this.anchorPosition = next;
    this.anchorTime = this.now();
    this.cursor = upperBoundByTime(this.events, next);
    this.onChange({ type: 'seek', position: next });
    return next;
  }

  setRate(rate) {
    if (![0.25, 0.5, 1, 2].includes(rate)) return false;
    const wallTime = this.now();
    if (this.playing) this.tick(wallTime);
    this.rate = rate;
    this.anchorTime = wallTime;
    this.anchorPosition = this.position;
    this.onChange({ type: 'rate', position: this.position, rate });
    return true;
  }

  setLoop(loop) {
    this.loop = loop === true;
    this.onChange({ type: 'loop-setting', position: this.position, loop: this.loop });
  }

  processDue(position) {
    const due = [];
    while (this.cursor < this.events.length
      && this.events[this.cursor].timestamp <= position) {
      due.push(this.events[this.cursor]);
      this.cursor += 1;
    }
    if (due.length) this.onEvents(due);
    return due.length;
  }

  tick(wallTime = this.now()) {
    if (!this.playing) return this.position;
    const elapsed = Math.max(0, wallTime - this.anchorTime);
    let target = this.anchorPosition + elapsed * this.rate;

    if (this.loop && this.duration > 0) {
      let looped = false;
      while (target >= this.duration) {
        this.processDue(this.duration);
        target -= this.duration;
        this.cursor = 0;
        this.position = 0;
        this.onChange({ type: 'loop', position: 0 });
        looped = true;
      }
      this.processDue(target);
      this.position = target;
      if (looped) {
        this.anchorTime = wallTime;
        this.anchorPosition = target;
      }
    } else {
      target = Math.min(this.duration, target);
      this.processDue(target);
      this.position = target;
      if (target >= this.duration) {
        this.playing = false;
        this.anchorPosition = target;
        this.onChange({ type: 'ended', position: target });
      }
    }
    this.onChange({ type: 'position', position: this.position });
    return this.position;
  }
}
