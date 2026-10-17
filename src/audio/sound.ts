import { settings, onSettings, type Settings } from '../app/settings';
import type { SurfaceType } from '../track/types';

/**
 * Game sound. Recordings dropped into `public/sounds/` (listed in `sounds.json` there) are
 * used when present; anything missing is made up on the fly with Web Audio: an F1 V6 engine that
 * follows speed, gear and throttle, wind, tyre squeal, kerb and gravel rumble, and the
 * cockpit beeps (DRS available / open / closed, start lights, pit limiter). It only ever
 * follows one car: the one the camera is on.
 */

/** Gear change speeds (km/h), the same as the HUD's gear readout. */
export const GEAR_SPEEDS_KMH = [0, 85, 125, 160, 195, 230, 265, 300];
const TOP_GEAR_END_KMH = 345;
const IDLE_RPM = 4200;
const SHIFT_RPM = 11800;
/** Revs just after an upshift (gears 2-8). */
const LOW_RPM = 9000;
const LIMITER_RPM = 12400;

export function gearFor(kmh: number): number {
  let g = 1;
  for (let i = 1; i < GEAR_SPEEDS_KMH.length; i++) if (kmh > GEAR_SPEEDS_KMH[i]) g = i + 1;
  return g;
}

/**
 * Engine revs for a speed and throttle: they climb through each gear and drop at every
 * upshift. Standing still, the throttle revs the engine (on the grid).
 */
export function engineRpm(kmh: number, throttle: number): number {
  const g = gearFor(kmh);
  const lo = GEAR_SPEEDS_KMH[g - 1];
  const hi = GEAR_SPEEDS_KMH[g] ?? TOP_GEAR_END_KMH;
  const f = Math.min(1, (kmh - lo) / (hi - lo));
  const fromSpeed = g === 1 ? IDLE_RPM + f * (SHIFT_RPM - IDLE_RPM) : LOW_RPM + f * (SHIFT_RPM - LOW_RPM);
  const revving = IDLE_RPM + throttle * (SHIFT_RPM - 1500 - IDLE_RPM);
  return Math.min(LIMITER_RPM, g === 1 ? Math.max(fromSpeed, revving) : fromSpeed);
}

/** What the sound needs to know about the followed car, once per frame. */
export interface SoundFrame {
  /** Which car this is (switching cars doesn't beep for the new car's state). */
  carId: string;
  /** Position (m), to tell a teleport (reset, time trial restart) from a crash. */
  x: number;
  y: number;
  /** m/s */
  speed: number;
  throttle: number;
  brake: number;
  sliding: boolean;
  surface: SurfaceType;
  drsOpen: boolean;
  /** In a DRS zone and allowed to open it. */
  drsAvailable: boolean;
  ersActive: boolean;
  limiter: boolean;
  /** Retired, or waiting to go back on track: engine off. */
  stopped: boolean;
  /** Red start lights showing (0-5). */
  lights: number;
}

interface Loop<S extends AudioScheduledSourceNode = AudioBufferSourceNode> {
  src: S;
  gain: GainNode;
}

/** `public/sounds/sounds.json`: which files to use. Missing files are skipped. */
interface SoundManifest {
  /** Steady engine loops, each recorded at about these revs. */
  engine?: { file: string; rpm: number }[];
  drsOpen?: string;
  drsClose?: string;
  drsAvailable?: string;
  light?: string;
  shift?: string;
  crash?: string;
  squeal?: string;
  wind?: string;
}

type OneShot = 'drsOpen' | 'drsClose' | 'drsAvailable' | 'light' | 'shift' | 'crash';

interface EngineSample {
  rpm: number;
  src: AudioBufferSourceNode;
  gain: GainNode;
}

/**
 * How loud each engine loop plays at these revs (loops sorted by their revs): a crossfade
 * between the two loops either side.
 */
export function engineMix(loopRpms: number[], rpm: number): number[] {
  const w = loopRpms.map(() => 0);
  if (w.length === 0) return w;
  if (rpm <= loopRpms[0]) w[0] = 1;
  else if (rpm >= loopRpms[w.length - 1]) w[w.length - 1] = 1;
  else {
    const i = loopRpms.findIndex((r) => r > rpm);
    const f = (rpm - loopRpms[i - 1]) / (loopRpms[i] - loopRpms[i - 1]);
    w[i - 1] = Math.cos((f * Math.PI) / 2);
    w[i] = Math.sin((f * Math.PI) / 2);
  }
  return w;
}

const SURFACE_RANK: Record<SurfaceType, number> = { asphalt: 0, pit: 0, kerb: 1, grass: 2, gravel: 3, wall: 0 };

/** The rougher of the two axles' surfaces (what you'd hear). */
export function loudestSurface(a: SurfaceType, b: SurfaceType): SurfaceType {
  return SURFACE_RANK[b] > SURFACE_RANK[a] ? b : a;
}

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private engineBus!: GainNode;
  private fxBus!: GainNode;
  private noise!: AudioBuffer;

  // Engine.
  private oscs: OscillatorNode[] = [];
  private engineFilter!: BiquadFilterNode;
  private engineGain!: GainNode;
  private turbo!: Loop<OscillatorNode>;
  private ers!: Loop<OscillatorNode>;
  // Car noise.
  private wind!: Loop;
  private windFilter!: BiquadFilterNode;
  private squeal!: Loop;
  private rumble!: Loop;
  private rumbleFilter!: BiquadFilterNode;
  private drsAir!: Loop;

  // Recordings from public/sounds (empty until loaded, or if there are none).
  private engineSamples: EngineSample[] = [];
  private sampleFilter!: BiquadFilterNode;
  private sampleGain!: GainNode;
  private readonly oneShots = new Map<OneShot, AudioBuffer>();
  private lastGear = 1;

  private rpm = IDLE_RPM;
  private last: SoundFrame | null = null;
  private lastSpeed = 0;
  private lastThrottle = 0;
  private time = 0;
  /** Paused or hidden: silent. */
  private muted = false;

  constructor() {
    onSettings((s) => this.applySettings(s));
  }

  /** Browsers only allow sound after a click or key press: call from one. */
  unlock(): void {
    if (typeof AudioContext === 'undefined') return;
    if (!this.ctx) {
      try {
        this.build(new AudioContext());
      } catch (err) {
        console.warn(err);
        return;
      }
    }
    if (this.ctx!.state === 'suspended') void this.ctx!.resume().catch(() => {});
  }

  /** Silence everything (menu open, tab hidden, game over). */
  setMuted(muted: boolean): void {
    if (this.muted === muted) return;
    this.muted = muted;
    this.applySettings(settings());
    if (muted) this.last = null;
  }

  private build(ctx: AudioContext): void {
    this.ctx = ctx;
    this.master = ctx.createGain();
    // A gentle limiter so stacked sounds never clip.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 6;
    this.master.connect(comp).connect(ctx.destination);
    this.engineBus = ctx.createGain();
    this.fxBus = ctx.createGain();
    this.engineBus.connect(this.master);
    this.fxBus.connect(this.master);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    // Engine: a turbo V6 is a raspy sawtooth stack at the firing frequency, clipped a little
    // and darker off the throttle.
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.Q.value = 2;
    const shaper = ctx.createWaveShaper();
    shaper.curve = softClip(2.5);
    const mix = ctx.createGain();
    mix.gain.value = 0.35;
    const voices: [OscillatorType, number, number][] = [
      ['sawtooth', 1, 0.5],
      ['sawtooth', 0.5, 0.45],
      ['square', 2, 0.12],
      ['sawtooth', 1.5, 0.15],
    ];
    for (const [type, , level] of voices) {
      const o = ctx.createOscillator();
      o.type = type;
      const g = ctx.createGain();
      g.gain.value = level;
      o.connect(g).connect(mix);
      o.start();
      this.oscs.push(o);
    }
    this.oscs[1].detune.value = 6;
    mix.connect(shaper).connect(this.engineFilter).connect(this.engineGain).connect(this.engineBus);
    this.turbo = this.tone('sine', 3000, this.engineBus);
    this.ers = this.tone('sine', 1500, this.engineBus);

    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.wind = this.noiseLoop(this.windFilter, this.engineBus);
    const squealFilter = ctx.createBiquadFilter();
    squealFilter.type = 'bandpass';
    squealFilter.frequency.value = 2300;
    squealFilter.Q.value = 9;
    this.squeal = this.noiseLoop(squealFilter, this.engineBus);
    this.rumbleFilter = ctx.createBiquadFilter();
    this.rumbleFilter.type = 'lowpass';
    this.rumble = this.noiseLoop(this.rumbleFilter, this.engineBus);
    const airFilter = ctx.createBiquadFilter();
    airFilter.type = 'highpass';
    airFilter.frequency.value = 3500;
    this.drsAir = this.noiseLoop(airFilter, this.fxBus);

    this.sampleGain = ctx.createGain();
    this.sampleGain.gain.value = 0;
    this.sampleFilter = ctx.createBiquadFilter();
    this.sampleFilter.type = 'lowpass';
    this.sampleFilter.connect(this.sampleGain).connect(this.engineBus);

    this.applySettings(settings());
    void this.loadSamples();
  }

  /** Use whatever recordings are in public/sounds. */
  private async loadSamples(): Promise<void> {
    const base = `${import.meta.env.BASE_URL}sounds/`;
    let manifest: SoundManifest;
    try {
      const res = await fetch(`${base}sounds.json`);
      if (!res.ok) return;
      manifest = (await res.json()) as SoundManifest;
    } catch {
      return;
    }
    const load = async (file: string | undefined): Promise<AudioBuffer | null> => {
      if (!file) return null;
      try {
        const res = await fetch(base + file);
        // (The dev server answers a missing file with the page itself.)
        if (!res.ok || res.headers.get('content-type')?.includes('text/html')) return null;
        return await this.ctx!.decodeAudioData(await res.arrayBuffer());
      } catch (err) {
        console.warn(`Sound ${file}:`, err);
        return null;
      }
    };
    const ctx = this.ctx!;
    const engines = await Promise.all((manifest.engine ?? []).map(async (e) => ({ rpm: e.rpm, buffer: await load(e.file) })));
    for (const e of engines.filter((e) => e.buffer).sort((a, b) => a.rpm - b.rpm)) {
      const src = ctx.createBufferSource();
      src.buffer = e.buffer;
      src.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(gain).connect(this.sampleFilter);
      src.start(0, Math.random() * e.buffer!.duration);
      this.engineSamples.push({ rpm: e.rpm, src, gain });
    }
    for (const key of ['drsOpen', 'drsClose', 'drsAvailable', 'light', 'shift', 'crash'] as const) {
      const b = await load(manifest[key]);
      if (b) this.oneShots.set(key, b);
    }
    // Recorded loops replace the made-up noise.
    for (const [file, loop] of [
      [manifest.squeal, this.squeal],
      [manifest.wind, this.wind],
    ] as const) {
      const b = await load(file);
      if (!b) continue;
      loop.src.stop();
      const src = ctx.createBufferSource();
      src.buffer = b;
      src.loop = true;
      src.connect(loop.gain);
      src.start(0, Math.random() * b.duration);
      loop.src = src;
    }
  }

  /** Play a recording if there is one. Returns false if not (use the made-up sound). */
  private play(key: OneShot, volume = 1): boolean {
    const b = this.oneShots.get(key);
    if (!b) return false;
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = b;
    const g = ctx.createGain();
    g.gain.value = volume;
    src.connect(g).connect(key === 'shift' ? this.engineBus : this.fxBus);
    src.start();
    return true;
  }

  private tone(type: OscillatorType, freq: number, out: AudioNode): Loop<OscillatorNode> {
    const ctx = this.ctx!;
    const src = ctx.createOscillator();
    src.type = type;
    src.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(gain).connect(out);
    src.start();
    return { src, gain };
  }

  private noiseLoop(filter: BiquadFilterNode, out: AudioNode): Loop {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    // Different start points, so the loops don't sound alike.
    src.start(0, Math.random() * 2);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(out);
    return { src, gain };
  }

  private applySettings(s: Settings): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.sound && !this.muted ? s.volume : 0, t, 0.05);
    this.engineBus.gain.setTargetAtTime(s.engine ? 1 : 0, t, 0.05);
    this.fxBus.gain.setTargetAtTime(s.effects ? 1 : 0, t, 0.05);
  }

  /** Follow the car for one frame (dt: seconds since the last frame). */
  update(f: SoundFrame, dt: number): void {
    const ctx = this.ctx;
    if (!ctx || this.muted || dt <= 0) return;
    this.time += dt;
    const t = ctx.currentTime;
    const set = (p: AudioParam, v: number, tc = 0.03) => p.setTargetAtTime(v, t, tc);
    const prev = this.last && this.last.carId === f.carId ? this.last : null;
    const jumped = prev !== null && Math.hypot(f.x - prev.x, f.y - prev.y) > 5 + 3 * f.speed * dt;
    const kmh = f.speed * 3.6;

    // Engine revs: quick to drop (gear changes), a little slower to climb.
    let target = f.stopped ? 0 : engineRpm(kmh, f.throttle);
    // On the pit limiter the revs bounce off the cut.
    if (f.limiter && f.throttle > 0.5 && !f.stopped) target *= 1 + 0.04 * Math.sin(this.time * 2 * Math.PI * 9);
    const rate = target < this.rpm ? 30 : 9;
    this.rpm += (target - this.rpm) * (1 - Math.exp(-rate * dt));
    const fire = Math.max(30, this.rpm / 20);
    const ratios = [1, 0.5, 2, 1.5];
    this.oscs.forEach((o, i) => set(o.frequency, fire * ratios[i], 0.015));
    const on = f.stopped ? 0 : 1;
    const load = 0.35 + 0.65 * f.throttle;
    const recorded = this.engineSamples.length > 0;
    const synth = recorded ? 0 : on;
    set(this.engineGain.gain, synth * load * (0.16 + 0.1 * (this.rpm / SHIFT_RPM)));
    set(this.engineFilter.frequency, 500 + f.throttle * 2600 + (this.rpm / SHIFT_RPM) * 1500);
    set(this.turbo.src.frequency, 2200 + this.rpm * 0.25);
    set(this.turbo.gain.gain, synth * f.throttle * (this.rpm / SHIFT_RPM) ** 2 * 0.012);
    if (recorded) {
      // Recorded loops: sped up or slowed down to the revs, crossfaded between recordings.
      const revs = Math.max(IDLE_RPM, this.rpm);
      const mix = engineMix(
        this.engineSamples.map((e) => e.rpm),
        revs,
      );
      this.engineSamples.forEach((e, i) => {
        set(e.src.playbackRate, Math.max(0.3, Math.min(2.5, revs / e.rpm)), 0.015);
        set(e.gain.gain, mix[i]);
      });
      set(this.sampleGain.gain, on * (0.45 + 0.55 * f.throttle) * 0.8);
      // Off the throttle the engine sounds duller.
      set(this.sampleFilter.frequency, 1200 + f.throttle * 14000);
    }
    // Upshifts.
    const gear = gearFor(kmh);
    if (prev && gear > this.lastGear && f.throttle > 0.5 && !f.stopped) this.play('shift', 0.8);
    this.lastGear = gear;
    // MGU-K whine while ERS deploys, pitched to the car's speed.
    set(this.ers.src.frequency, 900 + kmh * 9);
    set(this.ers.gain.gain, f.ersActive && !f.stopped ? 0.025 : 0, 0.08);

    // Lifting off at high revs: a few pops from the exhaust.
    if (prev && this.lastThrottle > 0.8 && f.throttle < 0.2 && this.rpm > 9500 && !f.stopped) this.pops();
    this.lastThrottle = f.throttle;

    // Wind and the hiss of an open DRS flap.
    set(this.windFilter.frequency, 250 + kmh * 9);
    set(this.wind.gain.gain, Math.min(0.22, (kmh / 320) ** 2 * 0.2), 0.1);
    set(this.drsAir.gain.gain, f.drsOpen ? 0.03 : 0, 0.08);

    // Tyres at the limit, and rough surfaces.
    const offRoad = f.surface === 'grass' || f.surface === 'gravel';
    set(this.squeal.gain.gain, f.sliding && !offRoad && f.speed > 8 ? 0.06 : 0, 0.05);
    const rough = f.speed > 2 ? (f.surface === 'kerb' ? 0.25 : f.surface === 'gravel' ? 0.32 : f.surface === 'grass' ? 0.18 : 0) : 0;
    // Kerb stripes go by faster with speed.
    const stripes = f.surface === 'kerb' ? 0.5 + 0.5 * Math.sin(this.time * 2 * Math.PI * Math.min(40, f.speed / 2)) : 1;
    set(this.rumbleFilter.frequency, f.surface === 'gravel' ? 900 : 260, 0.05);
    set(this.rumble.gain.gain, rough * stripes * Math.min(1, f.speed / 30), 0.02);

    // Hits: a sudden loss of speed far beyond braking.
    const drop = this.lastSpeed - f.speed;
    if (prev && !jumped && drop > 3 + 40 * dt) {
      const level = Math.min(1, drop / 20);
      if (!this.play('crash', level)) this.thud(level);
    }
    this.lastSpeed = f.speed;

    if (prev) {
      if (f.drsAvailable && !prev.drsAvailable && !f.drsOpen && !this.play('drsAvailable')) this.beeps([1760, 1760], 0.07, 0.09);
      if (f.drsOpen && !prev.drsOpen && !this.play('drsOpen')) {
        this.clack(1);
        this.sweep(1000, 1700, 0.14);
      }
      // No closing sound recorded: the opening one again, if there is one.
      if (!f.drsOpen && prev.drsOpen && !this.play('drsClose') && !this.play('drsOpen', 0.7)) {
        this.clack(0.7);
        this.sweep(1500, 900, 0.12);
      }
      if (f.limiter !== prev.limiter) this.beeps(f.limiter ? [880, 1320] : [1320, 880], 0.06, 0.08);
      if (f.lights > prev.lights && !this.play('light')) this.beeps([700], 0.18, 0.1);
    }
    this.last = f;
  }

  // ---------- One-shot sounds

  private envelope(peak: number, attack: number, decay: number, start = 0): GainNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const t = ctx.currentTime + start;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }

  private beeps(freqs: number[], length: number, gap: number): void {
    const ctx = this.ctx!;
    freqs.forEach((freq, i) => {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = freq;
      const g = this.envelope(0.06, 0.005, length, i * gap);
      o.connect(g).connect(this.fxBus);
      const t = ctx.currentTime + i * gap;
      o.start(t);
      o.stop(t + length + 0.05);
    });
  }

  private sweep(from: number, to: number, length: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    const t = ctx.currentTime;
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(to, t + length);
    const g = this.envelope(0.1, 0.01, length);
    o.connect(g).connect(this.fxBus);
    o.start(t);
    o.stop(t + length + 0.05);
  }

  /** The DRS flap snapping open or shut. */
  private clack(level: number): void {
    this.noiseBurst(level * 0.35, 0.05, 'highpass', 1800, this.fxBus);
  }

  private thud(level: number): void {
    const ctx = this.ctx!;
    this.noiseBurst(level * 0.8, 0.25, 'lowpass', 500, this.fxBus);
    const o = ctx.createOscillator();
    o.frequency.value = 55;
    const g = this.envelope(level * 0.5, 0.005, 0.3);
    o.connect(g).connect(this.fxBus);
    o.start();
    o.stop(ctx.currentTime + 0.4);
  }

  private pops(): void {
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) this.noiseBurst(0.18, 0.04, 'bandpass', 700 + Math.random() * 600, this.engineBus, 0.05 + i * (0.06 + Math.random() * 0.08));
  }

  private noiseBurst(peak: number, length: number, type: BiquadFilterType, freq: number, out: AudioNode, start = 0): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const g = this.envelope(peak, 0.003, length, start);
    src.connect(filter).connect(g).connect(out);
    const t = ctx.currentTime + start;
    src.start(t, Math.random() * 1.5);
    src.stop(t + length + 0.05);
  }
}

function softClip(amount: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(amount * x) / Math.tanh(amount);
  }
  return curve;
}

let shared: GameAudio | null = null;

/** The one sound engine for the page. */
export function gameAudio(): GameAudio {
  shared ??= new GameAudio();
  return shared;
}
