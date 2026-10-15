// Sound effects, synthesised with Web Audio: no audio files to load. Each sound is a few
// shaped bursts of noise and short tones; footsteps change with the surface underfoot.
import type { SoundEvent } from './world';

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private slide: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  volume = 0.6;

  /** Browsers only allow audio after a user gesture: call this from the first click / key press. */
  resume() {
    const ctx = this.ensure();
    if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => {});
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.volume;
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      const ctx = new AudioContext();
      const master = ctx.createGain();
      master.gain.value = this.volume;
      master.connect(ctx.destination);
      // one second of white noise, reused by every sound
      const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.ctx = ctx;
      this.master = master;
      this.noise = buf;
      return ctx;
    } catch {
      return null; // no audio available: effects are simply silent
    }
  }

  // ---------- building blocks ----------
  /** A short shaped tone, optionally gliding from `f0` to `f1`. */
  private tone(f0: number, f1: number, dur: number, gain: number, type: OscillatorType = 'sine', delay = 0) {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.012, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** A short burst of filtered noise, with the filter gliding from `f0` to `f1`. */
  private burst(type: BiquadFilterType, f0: number, f1: number, dur: number, gain: number, q = 1, delay = 0) {
    const ctx = this.ensure();
    if (!ctx || !this.master || !this.noise) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(f0, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.01, dur / 3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  private jitter(base: number, amount = 0.12) {
    return base * (1 + (Math.random() * 2 - 1) * amount);
  }

  // ---------- gameplay ----------
  step(surface: 'grass' | 'sand' | 'block' | 'water', gain = 1) {
    const g = Math.max(0, Math.min(1, gain));
    if (g < 0.02) return;
    switch (surface) {
      case 'grass':
        this.burst('lowpass', this.jitter(1500), 500, 0.1, 0.34 * g, 0.7);
        this.tone(this.jitter(95), 60, 0.08, 0.12 * g, 'sine');
        break;
      case 'sand':
        this.burst('bandpass', this.jitter(1000), 600, 0.13, 0.32 * g, 0.6);
        this.burst('highpass', 3000, 2500, 0.06, 0.06 * g, 0.5);
        break;
      case 'block':
        this.burst('bandpass', this.jitter(2200), 1200, 0.06, 0.26 * g, 1.4);
        this.tone(this.jitter(170), 100, 0.09, 0.2 * g, 'triangle');
        break;
      case 'water':
        this.burst('bandpass', this.jitter(500), 1200, 0.2, 0.34 * g, 0.9);
        this.tone(this.jitter(500), this.jitter(900), 0.07, 0.07 * g, 'sine', 0.05);
        break;
    }
  }

  jump() {
    this.tone(this.jitter(240), 520, 0.14, 0.16, 'triangle');
    this.burst('highpass', 1200, 2400, 0.12, 0.1, 0.5);
  }

  land(strength: number) {
    const s = Math.max(0.1, Math.min(1, strength));
    this.burst('lowpass', 500, 140, 0.12 + 0.12 * s, 0.25 + 0.4 * s, 0.8);
    this.tone(120, 55, 0.16 + 0.08 * s, 0.18 + 0.25 * s, 'sine');
  }

  slideStart() {
    const ctx = this.ensure();
    if (!ctx || !this.master || !this.noise || this.slide) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 0.8;
    const t = ctx.currentTime;
    filter.frequency.setValueAtTime(2200, t);
    filter.frequency.exponentialRampToValueAtTime(700, t + 1.2);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.3, t + 0.05);
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    this.slide = { src, gain, filter };
  }

  slideEnd() {
    const ctx = this.ctx;
    const s = this.slide;
    if (!ctx || !s) return;
    this.slide = null;
    const t = ctx.currentTime;
    s.gain.gain.cancelScheduledValues(t);
    s.gain.gain.setValueAtTime(Math.max(0.0001, s.gain.gain.value), t);
    s.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    s.src.stop(t + 0.2);
  }

  grab() {
    this.burst('bandpass', 2500, 1500, 0.05, 0.22, 1.5);
    this.tone(210, 130, 0.1, 0.14, 'square');
  }

  mantle() {
    this.tone(this.jitter(160), 110, 0.14, 0.12, 'sawtooth'); // a small effort noise
    this.burst('lowpass', 600, 200, 0.1, 0.25, 0.8, 0.12);
    this.tone(90, 55, 0.14, 0.2, 'sine', 0.22);
  }

  splash(strength = 1) {
    const s = Math.max(0.3, Math.min(1, strength));
    this.burst('lowpass', 2600, 350, 0.38, 0.4 * s, 0.7);
    for (let i = 0; i < 3; i++) {
      const f = 400 + Math.random() * 600;
      this.tone(f, f * 1.8, 0.07, 0.07 * s, 'sine', 0.05 + i * 0.07);
    }
  }

  // ---------- interface ----------
  click() {
    this.tone(this.jitter(880, 0.03), 700, 0.045, 0.07, 'square');
  }

  join() {
    [523, 659, 784].forEach((f, i) => this.tone(f, f, 0.16, 0.1, 'triangle', i * 0.08));
  }

  message() {
    this.tone(700, 920, 0.07, 0.07, 'sine');
  }

  dm() {
    this.tone(880, 880, 0.1, 0.1, 'triangle');
    this.tone(1175, 1175, 0.14, 0.1, 'triangle', 0.1);
  }

  playerJoin() {
    this.tone(440, 660, 0.1, 0.06, 'sine');
  }

  playerLeave() {
    this.tone(500, 300, 0.12, 0.06, 'sine');
  }

  error() {
    this.tone(220, 140, 0.16, 0.12, 'square');
  }

  /** Play the sound for something that happened in the world. */
  handle(e: SoundEvent) {
    switch (e.kind) {
      case 'step':
        this.step(e.surface, e.gain);
        break;
      case 'jump':
        this.jump();
        break;
      case 'land':
        this.land(e.strength);
        break;
      case 'slideStart':
        this.slideStart();
        break;
      case 'slideEnd':
        this.slideEnd();
        break;
      case 'grab':
        this.grab();
        break;
      case 'mantle':
        this.mantle();
        break;
      case 'splash':
        this.splash(e.strength);
        break;
    }
  }
}
