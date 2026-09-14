import { MidiSource } from './midi-source.js';

// Phase 1 architecture placeholder. This source deliberately performs no
// permission request, device enumeration, or synthetic input.
export class WebMidiSource extends MidiSource {
  constructor() {
    super('live-midi');
    this.status = 'Hardware input not implemented yet';
    this.devices = [];
    this.channel = 'all';
  }

  selectChannel(channel) {
    if (channel === 'all' || (Number.isInteger(channel) && channel >= 1 && channel <= 16)) {
      this.channel = channel;
      return true;
    }
    return false;
  }
}
