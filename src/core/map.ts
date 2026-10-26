// Hex map (odd-r offset layout) and environment generation.
// The environment layer is what a real-world map will later replace (DESIGN.md §7).

import { Rng } from './rng';
import { clamp } from './dmath';
import type { Terrain, Tile, WorldMap } from './types';

const EVEN_ROW = [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]];
const ODD_ROW = [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]];

export function tileAt(map: WorldMap, col: number, row: number): Tile | undefined {
  if (col < 0 || row < 0 || col >= map.w || row >= map.h) return undefined;
  return map.tiles[row * map.w + col];
}

export function neighbors(map: WorldMap, t: Tile): Tile[] {
  const dirs = t.row & 1 ? ODD_ROW : EVEN_ROW;
  const out: Tile[] = [];
  for (const [dc, dr] of dirs) {
    const n = tileAt(map, t.col + dc, t.row + dr);
    if (n) out.push(n);
  }
  return out;
}

function cube(t: Tile): [number, number, number] {
  const x = t.col - (t.row - (t.row & 1)) / 2;
  const z = t.row;
  return [x, -x - z, z];
}

export function hexDistance(a: Tile, b: Tile): number {
  const [ax, ay, az] = cube(a);
  const [bx, by, bz] = cube(b);
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by), Math.abs(az - bz));
}

export function tilesWithin(map: WorldMap, center: Tile, radius: number): Tile[] {
  const out: Tile[] = [];
  for (let r = center.row - radius; r <= center.row + radius; r++) {
    for (let c = center.col - radius - 1; c <= center.col + radius + 1; c++) {
      const t = tileAt(map, c, r);
      if (t && hexDistance(center, t) <= radius) out.push(t);
    }
  }
  return out;
}

export function isLand(t: Tile): boolean {
  return t.terrain !== 'ocean' && t.terrain !== 'lake';
}

export const TERRAIN_NAMES: Record<Terrain, string> = {
  ocean: '海洋', lake: '湖泊', tundra: '冻原', desert: '荒漠', grassland: '草原', plains: '平原',
  forest: '森林', rainforest: '雨林', hills: '丘陵', mountains: '山地',
};

// --- noise -------------------------------------------------------------

function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(x: number, y: number, seed: number, octaves = 5): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * f, y * f, seed + i * 101);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

// --- generation --------------------------------------------------------

const PLANT_MSY: Record<Terrain, number> = {
  ocean: 0, lake: 0, tundra: 1, desert: 0.4, grassland: 3.5, plains: 4.5, forest: 5, rainforest: 7, hills: 3, mountains: 0.8,
};
const GAME_MSY: Record<Terrain, number> = {
  ocean: 0, lake: 0, tundra: 1.5, desert: 0.3, grassland: 3, plains: 2.5, forest: 2, rainforest: 1.5, hills: 2, mountains: 0.8,
};
const FERTILITY: Record<Terrain, number> = {
  ocean: 0, lake: 0, tundra: 0.05, desert: 0.05, grassland: 0.8, plains: 0.9, forest: 0.6, rainforest: 0.4, hills: 0.4, mountains: 0,
};

export function generateMap(seedStr: string, w = 56, h = 40): WorldMap {
  const rng = new Rng([0x9e3779b9, 0x243f6a88, 0xb7e15162, hashSeed(seedStr)]);
  for (let i = 0; i < 20; i++) rng.u32();
  const seed = hashSeed(seedStr) & 0x7fffffff;
  const tiles: Tile[] = [];

  const raw: number[] = [];
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const x = col + (row & 1 ? 0.5 : 0);
      const nx = (x / w) * 2 - 1;
      const ny = (row / h) * 2 - 1;
      const d = Math.sqrt(nx * nx * 0.9 + ny * ny * 1.1);
      const e = fbm(x / 11, row / 11, seed) * 0.8 + 0.45 * (1 - d * d) - 0.05;
      raw.push(e);
    }
  }
  const sorted = [...raw].sort((a, b) => a - b);
  const seaLevel = sorted[Math.floor(sorted.length * 0.42)];
  const maxE = sorted[sorted.length - 1];

  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const i = row * w + col;
      const land = raw[i] > seaLevel;
      const elev = land ? (raw[i] - seaLevel) / (maxE - seaLevel) : -1;
      const lat = row / (h - 1); // 0 = north (cold)
      const temp = 3 + 25 * lat - (land ? 18 * elev : 0) + (fbm(col / 7, row / 7, seed + 7, 3) - 0.5) * 6;
      tiles.push({
        id: i, col, row, elev, temp, rain: 0, terrain: land ? 'plains' : 'ocean', river: false, coast: false,
        plants: 0, plantsCap: 0, game: 0, gameCap: 0, fish: 0, fishCap: 0, fertility: 0,
        grain: false, animals: false, stone: 0, clay: false, copper: false, tin: false,
        owner: -1, plots: 0, maxPlots: 0,
      });
    }
  }
  const map: WorldMap = { w, h, tiles };

  // distance to ocean drives rainfall
  const oceanDist = bfsDistance(map, (t) => t.terrain === 'ocean');
  for (const t of tiles) {
    const n = fbm(t.col / 9, t.row / 9, seed + 31, 4);
    t.rain = clamp(n * 0.9 + 0.35 * (1 - Math.min(oceanDist[t.id], 10) / 10) - 0.1, 0, 1);
  }

  for (const t of tiles) {
    if (t.terrain === 'ocean') continue;
    t.terrain = biome(t);
  }

  // rivers: trace downhill from wet highlands
  const sources = tiles.filter((t) => t.terrain !== 'ocean' && t.elev > 0.35 && t.rain > 0.45);
  rng.shuffle(sources);
  const nRivers = Math.floor((w * h) / 140);
  for (let k = 0; k < Math.min(nRivers, sources.length); k++) {
    const path: Tile[] = [];
    let cur: Tile = sources[k];
    const seen = new Set<number>();
    while (cur.terrain !== 'ocean' && cur.terrain !== 'lake' && !seen.has(cur.id)) {
      seen.add(cur.id);
      path.push(cur);
      if (cur.river && path.length > 1) break; // joined another river
      let next: Tile | undefined;
      for (const n of neighbors(map, cur)) {
        if (!next || n.elev < next.elev) next = n;
      }
      if (!next || next.elev >= cur.elev) {
        if (path.length >= 4) {
          cur.terrain = 'lake';
          path.pop();
        }
        break;
      }
      cur = next;
    }
    if (path.length >= 4) for (const t of path) t.river = true;
  }

  for (const t of tiles) {
    if (!isLand(t)) {
      if (t.terrain === 'lake') {
        t.fishCap = 3 * 200;
      }
      continue;
    }
    const ns = neighbors(map, t);
    t.coast = ns.some((n) => n.terrain === 'ocean');
    const nearLake = ns.some((n) => n.terrain === 'lake');
    const riverMul = t.river ? 1.3 : 1;
    t.plantsCap = PLANT_MSY[t.terrain] * riverMul * 200;
    t.gameCap = GAME_MSY[t.terrain] * (t.river ? 1.15 : 1) * 333;
    t.fishCap = ((t.coast ? 4 : 0) + (t.river ? 2.5 : 0) + (nearLake ? 2 : 0)) * 200;
    let fert = FERTILITY[t.terrain] * (0.5 + t.rain * 0.5);
    if (t.river) fert += t.terrain === 'desert' ? 0.7 : 0.3;
    t.fertility = clamp(fert, 0, 1);
    t.maxPlots = Math.floor(t.fertility * 60);
    const flat = t.terrain === 'grassland' || t.terrain === 'plains' || t.terrain === 'hills';
    t.grain = flat && t.temp > 10 && t.temp < 25 && t.rain > 0.22 && t.rain < 0.7 && rng.chance(0.35);
    t.animals = flat && t.temp > 3 && t.temp < 26 && rng.chance(0.22);
    t.stone = t.terrain === 'hills' || t.terrain === 'mountains' ? 1 : t.river ? 0.5 : 0.25;
    t.clay = t.river || (t.terrain === 'plains' && t.rain > 0.5 && rng.chance(0.4));
    t.copper = (t.terrain === 'hills' || t.terrain === 'mountains') && rng.chance(0.12);
    t.tin = (t.terrain === 'hills' || t.terrain === 'mountains') && rng.chance(0.04);
    t.plants = t.plantsCap;
    t.game = t.gameCap;
    t.fish = t.fishCap;
  }
  for (const t of tiles) if (t.terrain === 'lake') t.fish = t.fishCap;
  return map;
}

function biome(t: Tile): Terrain {
  if (t.elev > 0.72) return 'mountains';
  if (t.temp < 0) return 'tundra';
  if (t.elev > 0.48) return 'hills';
  if (t.rain < 0.18) return t.temp > 8 ? 'desert' : 'tundra';
  if (t.rain < 0.4) return 'grassland';
  if (t.temp > 21 && t.rain > 0.62) return 'rainforest';
  if (t.rain > 0.52) return 'forest';
  return 'plains';
}

function bfsDistance(map: WorldMap, isSource: (t: Tile) => boolean): number[] {
  const dist = new Array(map.tiles.length).fill(Infinity);
  const queue: Tile[] = [];
  for (const t of map.tiles) {
    if (isSource(t)) {
      dist[t.id] = 0;
      queue.push(t);
    }
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const t = queue[qi];
    for (const n of neighbors(map, t)) {
      if (dist[n.id] > dist[t.id] + 1) {
        dist[n.id] = dist[t.id] + 1;
        queue.push(n);
      }
    }
  }
  return dist;
}

export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// --- travel ------------------------------------------------------------

const MOVE_COST: Record<Terrain, number> = {
  ocean: Infinity, lake: Infinity, tundra: 1.5, desert: 1.8, grassland: 1, plains: 1, forest: 1.6, rainforest: 2.2, hills: 2, mountains: 5,
};

export interface TravelTech {
  boats: boolean;
  wheel: boolean;
  sailing: boolean;
}

export function moveCost(t: Tile, tech: TravelTech): number {
  if (!isLand(t)) return tech.sailing && t.terrain === 'ocean' ? 1.5 : tech.boats && t.terrain === 'lake' ? 1.5 : Infinity;
  let c = MOVE_COST[t.terrain];
  if (tech.wheel && c <= 1.6) c *= 0.7;
  if (t.river) c += tech.boats ? 0.5 : 2.5;
  return c;
}

/** Dijkstra travel cost from one tile to all others. */
export function travelCosts(map: WorldMap, from: Tile, tech: TravelTech): number[] {
  const n = map.tiles.length;
  const dist = new Array<number>(n).fill(Infinity);
  dist[from.id] = 0;
  // binary heap of [cost, id]
  const heap: number[][] = [[0, from.id]];
  while (heap.length) {
    const [d, id] = heapPop(heap);
    if (d > dist[id]) continue;
    for (const nb of neighbors(map, map.tiles[id])) {
      const c = d + moveCost(nb, tech);
      if (c < dist[nb.id]) {
        dist[nb.id] = c;
        heapPush(heap, [c, nb.id]);
      }
    }
  }
  return dist;
}

function heapPush(h: number[][], v: number[]) {
  h.push(v);
  let i = h.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (h[p][0] < v[0] || (h[p][0] === v[0] && h[p][1] <= v[1])) break;
    h[i] = h[p];
    i = p;
  }
  h[i] = v;
}

function heapPop(h: number[][]): number[] {
  const top = h[0];
  const last = h.pop()!;
  if (h.length) {
    const less = (a: number[], b: number[]) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = -1;
      let best = last;
      if (l < h.length && less(h[l], best)) { m = l; best = h[l]; }
      if (r < h.length && less(h[r], best)) { m = r; best = h[r]; }
      if (m < 0) break;
      h[i] = h[m];
      i = m;
    }
    h[i] = last;
  }
  return top;
}

/** Score a tile as a home site for foragers/farmers using its radius-2 neighbourhood. */
export function siteScore(map: WorldMap, t: Tile, farming: boolean): number {
  if (!isLand(t) || t.terrain === 'mountains') return -Infinity;
  let s = 0;
  for (const n of tilesWithin(map, t, 2)) {
    if (n.owner >= 0) continue;
    s += (n.plantsCap / 200) + (n.gameCap / 333) + (n.fishCap / 200);
    if (farming) s += n.maxPlots * 0.15;
  }
  if (t.river) s += 2;
  return s;
}
