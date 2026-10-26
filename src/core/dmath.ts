// Deterministic math. Only + - * / and Math.sqrt are guaranteed bit-identical across JS engines,
// so transcendental functions used by the simulation are implemented here on top of them.

const LN2 = 0.6931471805599453;

export function exp(x: number): number {
  if (x > 700) return Infinity;
  if (x < -700) return 0;
  // range reduction: x = k*ln2 + r, |r| <= ln2/2
  const k = Math.round(x / LN2);
  const r = x - k * LN2;
  // Taylor series for e^r
  let term = 1;
  let sum = 1;
  for (let i = 1; i < 18; i++) {
    term = (term * r) / i;
    sum += term;
  }
  return sum * pow2(k);
}

function pow2(k: number): number {
  let result = 1;
  const base = k < 0 ? 0.5 : 2;
  let n = k < 0 ? -k : k;
  let b = base;
  while (n > 0) {
    if (n & 1) result *= b;
    b *= b;
    n >>= 1;
  }
  return result;
}

export function ln(x: number): number {
  if (x <= 0) return -Infinity;
  // reduce to m in [0.75, 1.5)
  let k = 0;
  while (x >= 1.5) { x *= 0.5; k++; }
  while (x < 0.75) { x *= 2; k--; }
  // ln(x) = 2 * atanh((x-1)/(x+1))
  const y = (x - 1) / (x + 1);
  const y2 = y * y;
  let term = y;
  let sum = 0;
  for (let i = 1; i < 40; i += 2) {
    sum += term / i;
    term *= y2;
  }
  return 2 * sum + k * LN2;
}

export function pow(base: number, e: number): number {
  if (base === 0) return e === 0 ? 1 : 0;
  return exp(e * ln(base));
}

export function sigmoid(x: number): number {
  return 1 / (1 + exp(-x));
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Seasonal factor in [-1, 1] using a deterministic polynomial cosine approximation. day 0 = midwinter. */
export function season(dayOfYear: number): number {
  // triangle-free smooth approximation of -cos(2πt) via Bhaskara-style parabola pieces
  const t = (dayOfYear % 360) / 360; // 0..1
  const u = t < 0.5 ? t * 2 : (1 - t) * 2; // 0..1..0
  // smoothstep gives a cosine-like curve from -1 to 1
  const s = u * u * (3 - 2 * u);
  return s * 2 - 1;
}
