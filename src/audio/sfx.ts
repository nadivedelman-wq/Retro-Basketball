/**
 * All sound is synthesised with WebAudio at runtime (no audio assets): dribbles, swishes,
 * rim clanks, whistles, the buzzer, crowd swells and a short original chiptune loop.
 */
type Ctx = AudioContext;

class Sound {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private crowdGain: GainNode | null = null;
  private musicTimer: number | null = null;
  muted = false;
  private unlocked = false;
  private wantMusic = false;
  sfxVolume = 0.8;
  musicVolume = 0.35;

  private ensure(): Ctx | null {
    if (typeof window === 'undefined' || !this.unlocked) return null;
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** Call from a user gesture so browsers allow audio. */
  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    this.ensure();
    if (this.wantMusic) this.startMusic();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.02);
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slide = 0, delay = 0) {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    g.gain.setValueAtTime(vol * this.sfxVolume, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, filter: number, q = 1, type: BiquadFilterType = 'bandpass', delay = 0) {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = filter;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol * this.sfxVolume, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
  }

  dribble() {
    this.tone(95, 0.08, 'sine', 0.35, -40);
    this.noise(0.04, 0.12, 300, 2);
  }
  pass() {
    this.noise(0.08, 0.12, 1200, 1.5);
  }
  catch() {
    this.tone(140, 0.05, 'triangle', 0.2, -50);
  }
  shot() {
    this.noise(0.12, 0.1, 900, 1);
  }
  swish() {
    this.noise(0.28, 0.35, 4200, 0.8, 'highpass');
  }
  rim() {
    this.tone(420, 0.25, 'square', 0.12, -120);
    this.tone(631, 0.2, 'square', 0.08, -200);
  }
  backboard() {
    this.tone(180, 0.18, 'triangle', 0.3, -60);
    this.noise(0.1, 0.15, 500, 1);
  }
  dunk() {
    this.tone(90, 0.35, 'square', 0.25, -40);
    this.noise(0.3, 0.3, 700, 0.7);
  }
  whistle() {
    this.tone(2600, 0.35, 'sine', 0.18, 60);
    this.tone(2750, 0.35, 'sine', 0.12, 40);
  }
  buzzer() {
    this.tone(160, 0.9, 'sawtooth', 0.18);
    this.tone(163, 0.9, 'square', 0.1);
  }
  steal() {
    this.tone(660, 0.08, 'square', 0.12);
    this.tone(880, 0.1, 'square', 0.12, 0, 0.07);
  }
  block() {
    this.tone(120, 0.15, 'square', 0.25, -60);
    this.noise(0.12, 0.2, 400, 1);
  }
  select() {
    this.tone(880, 0.05, 'square', 0.08);
  }
  confirm() {
    this.tone(660, 0.06, 'square', 0.1);
    this.tone(990, 0.08, 'square', 0.1, 0, 0.06);
  }
  error() {
    this.tone(200, 0.15, 'square', 0.12, -60);
  }
  meterTick() {
    this.tone(1200, 0.03, 'square', 0.04);
  }
  crowd(level: number) {
    this.noise(0.5 + level * 1.2, 0.08 + level * 0.18, 900, 0.4);
  }
  fanfare() {
    const notes = [523, 659, 784, 1046, 784, 1046];
    notes.forEach((n, i) => this.tone(n, 0.18, 'square', 0.1, 0, i * 0.12));
  }

  /** Low ambient crowd bed under live play. */
  startCrowd() {
    const ctx = this.ensure();
    if (!ctx || !this.master || this.crowdGain) return;
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 700;
    f.Q.value = 0.3;
    this.crowdGain = ctx.createGain();
    this.crowdGain.gain.value = 0.03 * this.sfxVolume;
    src.connect(f).connect(this.crowdGain).connect(this.master);
    src.start();
  }
  stopCrowd() {
    if (this.crowdGain && this.ctx) {
      this.crowdGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
      const g = this.crowdGain;
      setTimeout(() => g.disconnect(), 800);
    }
    this.crowdGain = null;
  }

  /** Original 8-bar chiptune for the menus. */
  startMusic() {
    this.wantMusic = true;
    if (this.musicTimer !== null) return;
    const ctx = this.ensure();
    if (!ctx) return;
    const bass = [110, 110, 147, 147, 131, 131, 98, 123];
    const lead = [440, 523, 587, 659, 587, 523, 494, 523, 440, 392, 440, 523, 587, 523, 494, 440];
    let step = 0;
    const tick = () => {
      if (this.muted) return;
      const v = this.musicVolume;
      const b = bass[Math.floor(step / 4) % bass.length];
      if (step % 2 === 0) this.tone(b, 0.22, 'triangle', 0.22 * v);
      if (step % 4 === 2) this.noise(0.05, 0.08 * v, 6000, 1, 'highpass');
      const l = lead[step % lead.length];
      if (step % 16 < 12 && step % 2 === 0) this.tone(l, 0.16, 'square', 0.07 * v);
      step++;
    };
    this.musicTimer = window.setInterval(tick, 150);
  }
  stopMusic() {
    this.wantMusic = false;
    if (this.musicTimer !== null) window.clearInterval(this.musicTimer);
    this.musicTimer = null;
  }
}

export const sfx = new Sound();
