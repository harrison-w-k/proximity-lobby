// Sound effects, synthesised with Web Audio: no audio files to load. Each sound is a few
// shaped bursts of noise and short tones; footsteps change with the surface underfoot.
/** Things that make a sound; the page maps these to audio. */
export type SoundEvent =
  | { kind: 'step'; surface: 'grass' | 'sand' | 'block' | 'water'; gain: number }
  | { kind: 'jump' }
  | { kind: 'land'; strength: number }
  | { kind: 'slideStart' }
  | { kind: 'slideEnd' }
  | { kind: 'grab' }
  | { kind: 'mantle' }
  | { kind: 'splash'; strength: number }
  | { kind: 'pickup' }
  | { kind: 'drop' }
  | { kind: 'throw'; power: number }
  | { kind: 'hit' }
  | { kind: 'score' }
  | { kind: 'coin' }
  | { kind: 'boing' }
  | { kind: 'target' };


export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private slide: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  volume = 0.45;

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
    this.burst('lowpass', 500, 140, 0.12 + 0.12 * s, 0.14 + 0.25 * s, 0.8);
    this.tone(120, 55, 0.16 + 0.08 * s, 0.1 + 0.16 * s, 'sine');
  }

  slideStart() {
    const ctx = this.ensure();
    if (!ctx || !this.master || !this.noise || this.slide) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.5;
    const t = ctx.currentTime;
    filter.frequency.setValueAtTime(900, t);
    filter.frequency.exponentialRampToValueAtTime(350, t + 1.0);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.05, t + 0.12);
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
    this.burst('bandpass', 2500, 1500, 0.05, 0.1, 1.5);
    this.tone(210, 130, 0.1, 0.06, 'triangle');
  }

  mantle() {
    this.tone(this.jitter(160), 110, 0.14, 0.05, 'triangle'); // a small effort noise
    this.burst('lowpass', 600, 200, 0.1, 0.12, 0.8, 0.12);
    this.tone(90, 55, 0.14, 0.1, 'sine', 0.22);
  }

  splash(strength = 1) {
    const s = Math.max(0.3, Math.min(1, strength));
    this.burst('lowpass', 2600, 350, 0.38, 0.4 * s, 0.7);
    for (let i = 0; i < 3; i++) {
      const f = 400 + Math.random() * 600;
      this.tone(f, f * 1.8, 0.07, 0.07 * s, 'sine', 0.05 + i * 0.07);
    }
  }

  pickup() {
    this.tone(420, 640, 0.07, 0.07, 'triangle');
    this.burst('bandpass', 1800, 2600, 0.05, 0.07, 1.2, 0.02);
  }

  drop() {
    this.tone(300, 150, 0.09, 0.08, 'sine');
    this.burst('lowpass', 700, 250, 0.08, 0.1, 0.8);
  }

  throwItem(power = 0.5) {
    const p = Math.max(0.1, Math.min(1, power));
    this.burst('bandpass', 500 + 900 * p, 3000, 0.16, 0.08 + 0.1 * p, 0.9);
    this.tone(180, 90, 0.1, 0.05, 'triangle');
  }

  /** Something thrown hit someone: a thump and a little comic "boing". */
  hit() {
    this.burst('lowpass', 800, 120, 0.2, 0.28, 0.8);
    this.tone(140, 60, 0.22, 0.2, 'sine');
    this.tone(330, 520, 0.18, 0.06, 'triangle', 0.08);
  }

  coin() {
    this.tone(988, 988, 0.07, 0.07, 'square');
    this.tone(1319, 1319, 0.16, 0.07, 'square', 0.07);
  }

  boing() {
    this.tone(180, 520, 0.22, 0.14, 'sine');
    this.tone(260, 700, 0.18, 0.05, 'triangle', 0.04);
  }

  target() {
    this.burst('bandpass', 1500, 900, 0.1, 0.16, 1.5);
    this.tone(660, 990, 0.18, 0.1, 'triangle');
    this.tone(880, 1320, 0.22, 0.08, 'triangle', 0.1);
  }

  /** A basket: a net swish and a rising chime. */
  score() {
    this.burst('bandpass', 3200, 1800, 0.22, 0.12, 0.7);
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, f, 0.2, 0.09, 'triangle', 0.08 + i * 0.07));
  }

  // ---------- animal battle royale ----------
  bite(heavy = false) {
    this.burst('bandpass', 2400, 600, 0.09, heavy ? 0.22 : 0.14, 1.2);
    this.tone(heavy ? 150 : 220, 80, 0.12, heavy ? 0.16 : 0.1, 'sawtooth');
  }

  swing() {
    this.burst('highpass', 900, 3000, 0.12, 0.08, 0.6);
  }

  roar() {
    this.tone(150, 70, 0.7, 0.2, 'sawtooth');
    this.tone(210, 90, 0.6, 0.1, 'square', 0.05);
    this.burst('lowpass', 1200, 200, 0.7, 0.2, 0.8);
  }

  howl() {
    this.tone(330, 520, 0.5, 0.12, 'sine');
    this.tone(520, 420, 0.7, 0.1, 'sine', 0.45);
  }

  whoosh() {
    this.burst('bandpass', 400, 2600, 0.25, 0.14, 0.8);
  }

  levelUp() {
    [392, 523, 659, 784, 1047].forEach((f, i) => this.tone(f, f, 0.18, 0.09, 'triangle', i * 0.07));
  }

  munch() {
    for (let i = 0; i < 3; i++) this.burst('bandpass', 1800, 900, 0.07, 0.1, 1.5, i * 0.14);
  }

  siren() {
    for (let i = 0; i < 3; i++) {
      this.tone(520, 740, 0.35, 0.1, 'sawtooth', i * 0.7);
      this.tone(740, 520, 0.35, 0.1, 'sawtooth', i * 0.7 + 0.35);
    }
  }

  death() {
    this.tone(260, 50, 0.7, 0.2, 'sawtooth');
    this.burst('lowpass', 700, 80, 0.6, 0.2, 0.8);
  }

  lava() {
    this.burst('lowpass', 300, 120, 0.25, 0.1, 0.5);
  }

  win() {
    [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, f, 0.3, 0.1, 'triangle', i * 0.12));
  }

  /** The telegraph of an incoming attack: a rising growl-whoosh that says "block or dodge now". */
  windup(heavy = false) {
    this.tone(heavy ? 90 : 160, heavy ? 240 : 330, heavy ? 0.34 : 0.16, heavy ? 0.1 : 0.06, 'sawtooth');
    this.burst('bandpass', 500, heavy ? 2400 : 1800, heavy ? 0.34 : 0.16, heavy ? 0.1 : 0.06, 1.2);
  }

  /** A parry: a bright metallic clang. */
  parry() {
    this.tone(1480, 1480, 0.28, 0.12, 'square');
    this.tone(2220, 1900, 0.22, 0.07, 'triangle');
    this.tone(740, 700, 0.3, 0.08, 'sine', 0.01);
    this.burst('highpass', 3500, 5000, 0.12, 0.12, 0.8);
  }

  block(broke = false) {
    if (broke) {
      this.tone(220, 70, 0.35, 0.2, 'sawtooth');
      this.burst('lowpass', 1400, 180, 0.3, 0.22, 0.8);
      return;
    }
    this.tone(180, 110, 0.12, 0.14, 'triangle');
    this.burst('bandpass', 1800, 900, 0.07, 0.1, 1.4);
  }

  /** A soft tick when an animal is brought into focus on the select screen. */
  hoverTick() {
    this.tone(this.jitter(1240, 0.04), 1500, 0.05, 0.04, 'triangle');
  }

  /** The select screen's rising whoosh and chime when you choose an animal. */
  choose() {
    this.burst('bandpass', 300, 2600, 0.28, 0.09, 0.8);
    [523, 659, 880].forEach((f, i) => this.tone(f, f, 0.2, 0.08, 'triangle', 0.06 + i * 0.07));
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
      case 'pickup':
        this.pickup();
        break;
      case 'drop':
        this.drop();
        break;
      case 'throw':
        this.throwItem(e.power);
        break;
      case 'hit':
        this.hit();
        break;
      case 'score':
        this.score();
        break;
      case 'coin':
        this.coin();
        break;
      case 'boing':
        this.boing();
        break;
      case 'target':
        this.target();
        break;
    }
  }
}
