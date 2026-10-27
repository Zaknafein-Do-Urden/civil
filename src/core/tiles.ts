// Per-tile history (last 100 years, compact) and per-tile carrying-capacity estimate (DESIGN.md §7.1).
//
// Each yearly snapshot is one base64 string. Values are stored field-major (all plants, then all game, ...)
// so the long runs of untouched wilderness (stock at cap, no farmland) collapse under run-length encoding.

import { clamp, season } from './dmath';
import { isLand } from './map';
import { has } from './tech';
import type { Tile, World, WorldMap } from './types';

export const TILE_HISTORY_YEARS = 100;

export interface TileHistory {
  /** Day each snapshot was taken (end of a year), oldest first. */
  days: number[];
  /** Encoded snapshot per entry of `days`. */
  data: string[];
}

export interface TileSnapshot {
  /** Stock as a fraction of the tile's cap (0..1), NaN where the tile has no such resource. */
  plants: Float32Array;
  game: Float32Array;
  fish: Float32Array;
  /** Cleared plots, NaN where the tile cannot be farmed. */
  plots: Float32Array;
  /** Owning settlement id, -1 when unowned or not land. */
  owner: Int32Array;
}

export function emptyTileHistory(): TileHistory {
  return { days: [], data: [] };
}

const Q = 250; // quantization steps for stock fractions; 251..255 are reserved
const RUN = 255;

type Field = 'plants' | 'game' | 'fish' | 'plots';
const FIELDS: Field[] = ['plants', 'game', 'fish', 'plots'];

function hasField(t: Tile, f: Field): boolean {
  if (f === 'plots') return t.maxPlots > 0;
  return t[(f + 'Cap') as 'plantsCap' | 'gameCap' | 'fishCap'] > 0;
}

function quantize(t: Tile, f: Field): number {
  if (f === 'plots') return Math.min(Q, Math.round(t.plots * 4));
  const cap = t[(f + 'Cap') as 'plantsCap' | 'gameCap' | 'fishCap'];
  return Math.round(clamp(t[f] / cap, 0, 1) * Q);
}

/** Append a snapshot of every tile; drops the oldest beyond TILE_HISTORY_YEARS. */
export function recordTileHistory(world: World): void {
  const tiles = world.map.tiles;
  const out: number[] = [];
  for (const f of FIELDS) {
    let prev = -1;
    let run = 0;
    const flush = () => {
      if (run >= 3) out.push(RUN, prev, run);
      else for (let i = 0; i < run; i++) out.push(prev);
    };
    for (const t of tiles) {
      if (!hasField(t, f)) continue;
      const v = quantize(t, f);
      if (v === prev && run < 255) run++;
      else {
        flush();
        prev = v;
        run = 1;
      }
    }
    flush();
  }
  // owner: runs of (owner + 1 as u16, length u8) over land tiles
  let prev = -2;
  let run = 0;
  const flushOwner = () => {
    if (run) out.push((prev + 1) >> 8, (prev + 1) & 255, run);
  };
  for (const t of tiles) {
    if (!isLand(t)) continue;
    if (t.owner === prev && run < 255) run++;
    else {
      flushOwner();
      prev = t.owner;
      run = 1;
    }
  }
  flushOwner();

  const h = world.tileHistory;
  h.days.push(world.day);
  h.data.push(toBase64(out));
  while (h.days.length > TILE_HISTORY_YEARS) {
    h.days.shift();
    h.data.shift();
  }
}

export function decodeTileSnapshot(map: WorldMap, s: string): TileSnapshot {
  const n = map.tiles.length;
  const snap: TileSnapshot = {
    plants: new Float32Array(n).fill(NaN),
    game: new Float32Array(n).fill(NaN),
    fish: new Float32Array(n).fill(NaN),
    plots: new Float32Array(n).fill(NaN),
    owner: new Int32Array(n).fill(-1),
  };
  const b = fromBase64(s);
  let i = 0;
  for (const f of FIELDS) {
    const arr = snap[f];
    let v = 0;
    let left = 0;
    for (const t of map.tiles) {
      if (!hasField(t, f)) continue;
      if (!left) {
        if (b[i] === RUN) {
          v = b[i + 1];
          left = b[i + 2];
          i += 3;
        } else {
          v = b[i++];
          left = 1;
        }
      }
      arr[t.id] = f === 'plots' ? v / 4 : v / Q;
      left--;
    }
  }
  let owner = -1;
  let left = 0;
  for (const t of map.tiles) {
    if (!isLand(t)) continue;
    if (!left) {
      owner = ((b[i] << 8) | b[i + 1]) - 1;
      left = b[i + 2];
      i += 3;
    }
    snap.owner[t.id] = owner;
    left--;
  }
  return snap;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function toBase64(bytes: number[]): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    s += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=';
    s += i + 2 < bytes.length ? B64[n & 63] : '=';
  }
  return s;
}

function fromBase64(s: string): Uint8Array {
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((s.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    const n = (B64.indexOf(s[i]) << 18) | (B64.indexOf(s[i + 1]) << 12) | (Math.max(0, B64.indexOf(s[i + 2])) << 6) | Math.max(0, B64.indexOf(s[i + 3]));
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

// --- carrying capacity ---------------------------------------------------

export interface TileCapacity {
  /** Sustainable wild food per day (plants + game + fish if fishing is known), at current farmland. */
  wild: number;
  /** Food per day if all arable land were farmed (0 before agriculture), plus the wild remainder. */
  farmed: number;
  /** People the better of the two can feed. */
  people: number;
  agriculture: boolean;
}

/** Wild growth factor (as in regenTiles) and crop growing factor (as in dailySettlement), averaged over a year. */
function growthAverages(t: Tile): { wild: number; crop: number } {
  let w = 0;
  let c = 0;
  for (let m = 0; m < 12; m++) {
    const temp = t.temp + 12 * season(m * 30 + 15);
    w += clamp((temp - 2) / 15, 0, 1) * (0.4 + 0.6 * t.rain);
    c += clamp((temp - 5) / 15, 0, 1) / 0.55;
  }
  return { wild: w / 12, crop: c / 12 };
}

/**
 * Maximum sustainable yield of a tile under current technology. Logistic regrowth r·N·(1−N/K) + immigration
 * peaks at N = K/2, so MSY = K·(r/4 + immigration). A rough planning figure: ignores labour, tools and effort.
 */
/**
 * Share of the theoretical maximum yield people actually sustain: yields fall as stocks thin, and the lean
 * season limits a camp more than the yearly average. Calibrated so camps that stay at this size stop starving.
 */
const HARVEST_EFFICIENCY = 0.7;

export function tileCapacity(world: World, t: Tile): TileCapacity {
  const P = world.params;
  const g = growthAverages(t);
  const forage = (plotShare: number) => {
    const wild = t.maxPlots > 0 ? 1 - plotShare * 0.7 : 1;
    let f = t.plantsCap * wild * g.wild * (P.plantRegen * 2 / 4 + 0.002) + t.gameCap * wild * (P.gameRegen / 4 + 0.001);
    if (has(world, 'fishing')) f += t.fishCap * (0.02 / 4 + 0.001);
    return f;
  };
  const wild = forage(t.maxPlots > 0 ? t.plots / t.maxPlots : 0);
  const agriculture = has(world, 'agriculture');
  let farmed = 0;
  if (agriculture && t.maxPlots > 0) {
    let mult = 1;
    if (has(world, 'calendar')) mult *= 1.2;
    if (has(world, 'plough')) mult *= 1.4;
    if (has(world, 'irrigation') && t.river) mult *= 1.5;
    farmed = t.maxPlots * P.farmRate * mult * t.fertility * g.crop + forage(1);
  }
  // average consumer: mix of adults, children (0.6) and elders (0.8)
  const perHead = P.foodNeedAdult * 0.9;
  return { wild, farmed, people: (Math.max(wild, farmed) * HARVEST_EFFICIENCY) / perHead, agriculture };
}
