// Lydeffekter syntetiseret med WebAudio — ingen lydfiler nødvendige.
// AudioContext oprettes først ved brugerens første tryk (browserkrav).

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
try {
  muted = localStorage.getItem("telefon-wii:muted") === "1";
} catch {}

function ensure(): AudioContext | null {
  try {
    if (!ctx) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return muted ? null : ctx;
  } catch {
    return null;
  }
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem("telefon-wii:muted", m ? "1" : "0");
  } catch {}
  if (master) master.gain.value = m ? 0 : 0.5;
  if (m) engine.stop();
}

function tone(freq: number, dur: number, type: OscillatorType = "sine", vol = 0.25, slideTo?: number, delay = 0) {
  const c = ensure();
  if (!c || !master) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function noiseBuffer(c: AudioContext): AudioBuffer {
  const buf = c.createBuffer(1, c.sampleRate, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

let cachedNoise: AudioBuffer | null = null;

function noise(dur: number, vol: number, filterFrom: number, filterTo?: number, type: BiquadFilterType = "lowpass") {
  const c = ensure();
  if (!c || !master) return;
  if (!cachedNoise) cachedNoise = noiseBuffer(c);
  const t0 = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = cachedNoise;
  src.loop = true;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(filterFrom, t0);
  if (filterTo) f.frequency.exponentialRampToValueAtTime(filterTo, t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

// --- Effekter ---

export function tap() {
  tone(520, 0.07, "square", 0.12);
}

export function whoosh() {
  noise(0.4, 0.35, 250, 2600);
}

export function swingHit() {
  noise(0.25, 0.3, 400, 3000);
  tone(180, 0.08, "square", 0.2, 90);
}

export function putt() {
  tone(220, 0.06, "square", 0.18);
}

export function crash(intensity: number) {
  const v = Math.min(1, 0.25 + intensity * 0.08);
  noise(0.55, v, 4000, 500, "highpass");
  for (let i = 0; i < Math.min(6, intensity); i++) {
    tone(600 + Math.random() * 900, 0.12, "triangle", 0.12, undefined, Math.random() * 0.15);
  }
}

export function plink() {
  tone(880, 0.12, "sine", 0.3, 1320);
  tone(1760, 0.2, "sine", 0.15, undefined, 0.1);
}

export function splash() {
  noise(0.6, 0.4, 900, 200);
}

export function fanfare() {
  const notes = [523, 659, 784, 1047];
  notes.forEach((f, i) => tone(f, i === 3 ? 0.4 : 0.16, "square", 0.16, undefined, i * 0.13));
}

export function sad() {
  tone(330, 0.25, "square", 0.15, 260);
  tone(240, 0.4, "square", 0.15, 180, 0.25);
}

export function beep(go = false) {
  tone(go ? 880 : 440, go ? 0.45 : 0.15, "square", 0.2);
}

export function boost() {
  tone(300, 0.35, "sawtooth", 0.2, 950);
}

// Kart-motorlyd: kørende oscillator med tonehøjde efter fart
class EngineSound {
  private osc1: OscillatorNode | null = null;
  private osc2: OscillatorNode | null = null;
  private gain: GainNode | null = null;

  start() {
    const c = ensure();
    if (!c || !master || this.osc1) return;
    this.osc1 = c.createOscillator();
    this.osc2 = c.createOscillator();
    this.osc1.type = "sawtooth";
    this.osc2.type = "sawtooth";
    this.osc2.detune.value = 18;
    const f = c.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 500;
    this.gain = c.createGain();
    this.gain.gain.value = 0.06;
    this.osc1.connect(f);
    this.osc2.connect(f);
    f.connect(this.gain).connect(master);
    this.setSpeed(0);
    this.osc1.start();
    this.osc2.start();
  }

  setSpeed(v: number) {
    if (!this.osc1 || !this.osc2 || !ctx) return;
    const freq = 55 + v * 130;
    this.osc1.frequency.setTargetAtTime(freq, ctx.currentTime, 0.1);
    this.osc2.frequency.setTargetAtTime(freq * 1.5, ctx.currentTime, 0.1);
  }

  stop() {
    try {
      this.osc1?.stop();
      this.osc2?.stop();
    } catch {}
    this.osc1 = null;
    this.osc2 = null;
    this.gain = null;
  }
}

export const engine = new EngineSound();
