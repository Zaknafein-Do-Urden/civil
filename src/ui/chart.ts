// Minimal canvas line / stacked-area chart for yearly series.

export interface Series {
  name: string;
  color: string;
  values: number[];
}

export interface ChartOpts {
  min?: number;
  max?: number;
  stacked?: boolean;
  format?: (v: number) => string;
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}

export function drawChart(canvas: HTMLCanvasElement, xs: number[], series: Series[], opts: ChartOpts = {}): void {
  const dpr = window.devicePixelRatio || 1;
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  const padL = 38;
  const padR = 6;
  const padT = 16;
  const padB = 16;
  const w = cw - padL - padR;
  const hgt = ch - padT - padB;
  const n = xs.length;
  const fmt = opts.format ?? ((v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(v < 10 && v % 1 ? 2 : 0)));

  let lo = opts.min ?? Infinity;
  let hi = opts.max ?? -Infinity;
  const stackTop: number[] = new Array(n).fill(0);
  if (opts.stacked) {
    for (const s of series) s.values.forEach((v, i) => (stackTop[i] += v));
    if (opts.min === undefined) lo = 0;
    if (opts.max === undefined) hi = Math.max(1, ...stackTop);
  } else {
    for (const s of series) for (const v of s.values) {
      if (opts.min === undefined) lo = Math.min(lo, v);
      if (opts.max === undefined) hi = Math.max(hi, v);
    }
  }
  if (!Number.isFinite(lo)) lo = 0;
  if (!Number.isFinite(hi) || hi <= lo) hi = lo + 1;

  const grid = cssVar('--grid');
  const text = cssVar('--muted');
  ctx.font = '10px system-ui, sans-serif';
  ctx.fillStyle = text;
  ctx.strokeStyle = grid;
  ctx.lineWidth = 1;
  for (let k = 0; k <= 3; k++) {
    const v = lo + ((hi - lo) * k) / 3;
    const y = padT + hgt - (hgt * k) / 3;
    ctx.beginPath();
    ctx.moveTo(padL, y + 0.5);
    ctx.lineTo(padL + w, y + 0.5);
    ctx.stroke();
    ctx.textAlign = 'right';
    ctx.fillText(fmt(v), padL - 4, y + 3);
  }
  if (n) {
    ctx.textAlign = 'left';
    ctx.fillText(`第${xs[0] + 1}年`, padL, ch - 3);
    ctx.textAlign = 'right';
    ctx.fillText(`第${xs[n - 1] + 1}年`, padL + w, ch - 3);
  }
  if (n < 2) {
    ctx.textAlign = 'center';
    ctx.fillText('数据积累中…', padL + w / 2, padT + hgt / 2);
    return;
  }
  const X = (i: number) => padL + (w * i) / (n - 1);
  const Y = (v: number) => padT + hgt - ((v - lo) / (hi - lo)) * hgt;

  if (opts.stacked) {
    const base = new Array(n).fill(0);
    for (const s of series) {
      ctx.beginPath();
      for (let i = 0; i < n; i++) ctx.lineTo(X(i), Y(base[i] + s.values[i]));
      for (let i = n - 1; i >= 0; i--) ctx.lineTo(X(i), Y(base[i]));
      ctx.closePath();
      ctx.fillStyle = s.color;
      ctx.globalAlpha = 0.85;
      ctx.fill();
      ctx.globalAlpha = 1;
      for (let i = 0; i < n; i++) base[i] += s.values[i];
    }
  } else {
    for (const s of series) {
      ctx.beginPath();
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.6;
      s.values.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
      ctx.stroke();
    }
  }
  // legend
  let lx = padL + 4;
  ctx.textAlign = 'left';
  for (const s of series) {
    ctx.fillStyle = s.color;
    ctx.fillRect(lx, 4, 8, 8);
    ctx.fillStyle = text;
    ctx.fillText(s.name, lx + 11, 11);
    lx += ctx.measureText(s.name).width + 22;
    if (lx > cw - 40) break;
  }
}
