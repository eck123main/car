/**
 * Calm background for the open road, all synthesized: soft wind that follows the car's speed, and
 * a slow pad of drifting chords with the odd bell note. No files, nothing to download.
 */

/** Chords as semitones above A2 (110 Hz), a slow loop. */
const CHORDS = [
  [0, 7, 12, 16, 19],
  [-4, 3, 8, 12, 15],
  [-7, 0, 5, 9, 16],
  [-2, 5, 10, 14, 17],
];
/** Bell notes, above the same A (a pentatonic scale). */
const BELLS = [24, 26, 28, 31, 33, 36, 38, 40];
const CHORD_TIME = 14;
const FADE_IN = 6;
const FADE_OUT = 8;
const PAD_LEVEL = 0.05;
const BELL_LEVEL = 0.035;

const hz = (semitones: number) => 110 * Math.pow(2, semitones / 12);

export class Ambient {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private padBus: GainNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private chord = 0;
  private nextChord = 0;
  private nextBell = 0;
  private volume = 0.6;
  musicOn = true;

  start(volume: number): void {
    this.volume = volume;
    if (this.ctx) return;
    try {
      const ctx = new AudioContext();
      this.ctx = ctx;
      void ctx.resume();
      const master = (this.master = ctx.createGain());
      master.gain.value = 0;
      master.gain.linearRampToValueAtTime(this.volume, ctx.currentTime + 2);
      master.connect(ctx.destination);

      // Wind: looped noise through a filter that opens with speed.
      const length = ctx.sampleRate * 4;
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < length; i++) {
        last = last * 0.97 + (Math.random() * 2 - 1) * 0.03;
        data[i] = last * 6;
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      noise.loop = true;
      this.windFilter = ctx.createBiquadFilter();
      this.windFilter.type = 'lowpass';
      this.windFilter.frequency.value = 300;
      this.windGain = ctx.createGain();
      this.windGain.gain.value = 0.02;
      noise.connect(this.windFilter).connect(this.windGain).connect(master);
      noise.start();

      // Music, through a soft filter and a long echo.
      const music = (this.music = ctx.createGain());
      music.gain.value = this.musicOn ? 1 : 0;
      music.connect(master);
      const soft = ctx.createBiquadFilter();
      soft.type = 'lowpass';
      soft.frequency.value = 1100;
      const delay = ctx.createDelay(2);
      delay.delayTime.value = 0.62;
      const feedback = ctx.createGain();
      feedback.gain.value = 0.48;
      const wet = ctx.createGain();
      wet.gain.value = 0.5;
      const bus = (this.padBus = ctx.createGain());
      bus.connect(soft);
      soft.connect(music);
      soft.connect(delay);
      delay.connect(feedback).connect(delay);
      delay.connect(wet).connect(music);

      this.nextChord = ctx.currentTime + 0.2;
      this.nextBell = ctx.currentTime + 10;
      this.timer = setInterval(() => this.schedule(), 500);
      this.schedule();
    } catch {
      // No Web Audio: a silent drive.
      this.ctx = null;
    }
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || !this.padBus) return;
    while (this.nextChord < ctx.currentTime + 1.5) {
      this.playChord(CHORDS[this.chord % CHORDS.length], this.nextChord);
      this.chord++;
      this.nextChord += CHORD_TIME;
    }
    while (this.nextBell < ctx.currentTime + 1.5) {
      this.playBell(this.nextBell);
      this.nextBell += 4 + Math.random() * 11;
    }
  }

  private playChord(notes: number[], at: number): void {
    const ctx = this.ctx!;
    const life = CHORD_TIME + FADE_OUT;
    for (const n of notes) {
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(PAD_LEVEL, at + FADE_IN);
      gain.gain.setValueAtTime(PAD_LEVEL, at + CHORD_TIME - 1);
      gain.gain.linearRampToValueAtTime(0, at + life);
      gain.connect(this.padBus!);
      for (const detune of [-6, 5]) {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = hz(n);
        osc.detune.value = detune;
        osc.connect(gain);
        osc.start(at);
        osc.stop(at + life + 0.1);
      }
    }
  }

  private playBell(at: number): void {
    const ctx = this.ctx!;
    const n = BELLS[Math.floor(Math.random() * BELLS.length)];
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(BELL_LEVEL, at + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0005, at + 3.5);
    gain.connect(this.padBus!);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = hz(n);
    osc.connect(gain);
    osc.start(at);
    osc.stop(at + 3.6);
  }

  /** Each frame: wind follows the speed (m/s). */
  update(speed: number, volume: number, muted: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.windGain || !this.windFilter) return;
    const k = Math.min(1, speed / 90);
    const now = ctx.currentTime;
    this.windGain.gain.setTargetAtTime(0.02 + 0.13 * k * k, now, 0.3);
    this.windFilter.frequency.setTargetAtTime(280 + 1100 * k, now, 0.3);
    this.master.gain.setTargetAtTime(muted ? 0 : volume, now, 0.25);
  }

  setMusic(on: boolean): void {
    this.musicOn = on;
    if (this.ctx && this.music) this.music.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.8);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    void this.ctx?.close();
    this.ctx = null;
    this.master = this.music = this.windGain = this.padBus = null;
    this.windFilter = null;
  }
}
