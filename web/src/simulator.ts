// In-browser synthetic PiEEG-16 source — the port of acquirer/simulator.py.
//
// Lets the GitHub Pages build run fully standalone (no server, no hardware):
// generates 16 channels of plausible EEG in μV with an alpha burst that waxes
// and wanes on a ~10 s cycle so the band-power bars visibly move.

export const NCH = 16;
export const SRATE = 250;

const BANDS: [number, number][] = [
  [2.0, 8.0], // delta
  [6.0, 6.0], // theta
  [10.0, 12.0], // alpha (modulated by burst)
  [20.0, 4.0], // beta
];
const ALPHA_BURST_PERIOD = 10.0;

// Small seeded PRNG (mulberry32) so the demo is reproducible if desired.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box–Muller Gaussian from a uniform generator.
function gauss(rand: () => number, sigma: number): number {
  const u = Math.max(rand(), 1e-12);
  const v = rand();
  return sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export class SimulatedPiEEG16 {
  readonly srate: number;
  private n = 0;
  private rand: () => number;
  private phase: number[];

  constructor(srate = SRATE, seed = 1) {
    this.srate = srate;
    this.rand = mulberry32(seed);
    this.phase = Array.from({ length: NCH }, () => this.rand() * 2 * Math.PI);
  }

  readSample(): number[] {
    const t = this.n / this.srate;
    const alphaEnv = 0.5 * (1 + Math.sin((2 * Math.PI * t) / ALPHA_BURST_PERIOD));
    const out = new Array(NCH);
    for (let ch = 0; ch < NCH; ch++) {
      let v = 0;
      for (const [freq, amp] of BANDS) {
        const gain = Math.abs(freq - 10.0) < 0.1 ? 0.4 + 1.2 * alphaEnv : 1.0;
        v += amp * gain * Math.sin(2 * Math.PI * freq * t + this.phase[ch]);
      }
      v += gauss(this.rand, 3.0);
      out[ch] = v;
    }
    this.n++;
    return out;
  }

  // Read `count` samples at once (a chunk).
  readChunk(count: number): number[][] {
    const rows = new Array(count);
    for (let i = 0; i < count; i++) rows[i] = this.readSample();
    return rows;
  }
}
