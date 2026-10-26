// Seeded PRNG (sfc32). State is four uint32s so it serializes as plain JSON.

export type RngState = [number, number, number, number];

export function seedRng(seed: number | string): RngState {
  // xmur3-style string hash to expand the seed into four words
  const str = String(seed);
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  const next = () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
  const s: RngState = [next(), next(), next(), next()];
  const r = new Rng(s);
  for (let i = 0; i < 15; i++) r.u32();
  return r.state;
}

export class Rng {
  constructor(public state: RngState) {}

  u32(): number {
    const s = this.state;
    let [a, b, c, d] = s;
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) >>> 0;
    s[0] = a >>> 0; s[1] = b; s[2] = c; s[3] = d;
    return t;
  }

  /** Uniform in [0, 1). */
  next(): number {
    return this.u32() / 4294967296;
  }

  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Approximate standard normal via Irwin–Hall (sum of 12 uniforms); avoids transcendental functions. */
  normal(): number {
    let s = 0;
    for (let i = 0; i < 12; i++) s += this.next();
    return s - 6;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }

  /** Index chosen with probability proportional to weights. */
  weighted(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += w > 0 ? w : 0;
    if (total <= 0) return this.int(weights.length);
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      const w = weights[i] > 0 ? weights[i] : 0;
      if (r < w) return i;
      r -= w;
    }
    return weights.length - 1;
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
}
