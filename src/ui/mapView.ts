// Hex map renderer (pointy-top, odd-r offset), shared by the setup screen and the game screen.

import { isLand, neighbors } from '../core/map';
import type { Terrain, Tile, World, WorldMap } from '../core/types';

const TERRAIN_COLOR: Record<Terrain, string> = {
  ocean: '#1d3b5c',
  lake: '#2f6a9a',
  tundra: '#c9d3d6',
  desert: '#d9c38c',
  grassland: '#a9c46a',
  plains: '#8fb35b',
  forest: '#4f8a3c',
  rainforest: '#2e6b33',
  hills: '#a08a5c',
  mountains: '#7b7470',
};

export function settlementColor(id: number): string {
  const hue = (id * 137.508) % 360;
  return `hsl(${hue.toFixed(0)} 70% 55%)`;
}

export type Overlay = 'terrain' | 'stock' | 'owner' | 'density' | 'fertility' | 'institutions';

/** Remaining wild food as a share of its cap, weighted by each resource's cap. NaN where nothing grows. */
export function stockRatio(t: Tile): number {
  const cap = t.plantsCap + t.gameCap + t.fishCap;
  return cap > 0 ? (t.plants + t.game + t.fish) / cap : NaN;
}

/** Red (exhausted) → yellow → green (untouched). */
function rampRYG(v: number): string {
  const x = Math.max(0, Math.min(1, v));
  const hue = x * 120;
  return `hsl(${hue.toFixed(0)} 65% ${(38 + 10 * (1 - Math.abs(x - 0.5) * 2)).toFixed(0)}%)`;
}

/** Dark → bright single-hue ramp. */
function ramp(v: number, hue: number): string {
  const x = Math.max(0, Math.min(1, v));
  return `hsl(${hue} ${(25 + 50 * x).toFixed(0)}% ${(18 + 45 * x).toFixed(0)}%)`;
}

const DENSITY_MAX = 10; // people per tile at the top of the scale

const NO_DATA = '#3a3f47';

function swatches(items: [string, string][]): string {
  return items.map(([c, l]) => `<span><i style="background:${c}"></i>${l}</span>`).join('');
}

/** Legend HTML for the game-screen map layers. */
export function legendHtml(o: Overlay): string {
  switch (o) {
    case 'stock':
      return `<b>资源存量</b>（野生植物＋猎物＋鱼 现存÷上限）${swatches([[rampRYG(0), '耗尽'], [rampRYG(0.5), '一半'], [rampRYG(1), '未开发'], [NO_DATA, '无资源']])}<span class="muted">谷/畜/铜/锡 = 特殊资源</span>`;
    case 'owner':
      return `<b>归属</b>${swatches([[settlementColor(1), '各聚落领地'], [NO_DATA, '无主之地']])}<span class="muted">实心＝聚落中心</span>`;
    case 'density':
      return `<b>人口密度</b>（聚落人口平摊到领地，人/格）${swatches([[NO_DATA, '0'], [ramp(0.2, 20), '2'], [ramp(0.5, 20), '5'], [ramp(1, 20), `≥${DENSITY_MAX}`]])}`;
    case 'fertility':
      return `<b>肥力</b>${swatches([[NO_DATA, '不可耕'], [ramp(0.25, 95), '低'], [ramp(1, 95), '高'], ['rgba(240,200,60,0.9)', '已开垦']])}`;
    case 'institutions':
      return `<b>执行力</b>：地形底图；红色虚线圈＝制度执行不到的聚落`;
    default:
      return `<b>地形</b>：底色为地形，黄色＝农田，彩色＝聚落领地，蓝线＝河流`;
  }
}

export class MapView {
  size = 10;
  ox = 0;
  oy = 0;
  overlay: Overlay = 'terrain';
  selectedTile = -1;
  selectedSettlement = -1;
  private downstream: number[] = [];

  constructor(public canvas: HTMLCanvasElement, private onClick: (tile: Tile) => void) {
    canvas.addEventListener('click', (e) => {
      const r = canvas.getBoundingClientRect();
      const t = this.pick(e.clientX - r.left, e.clientY - r.top);
      if (t) this.onClick(t);
    });
  }

  private map?: WorldMap;

  setMap(map: WorldMap): void {
    this.map = map;
    this.downstream = map.tiles.map((t) => {
      if (!t.river) return -1;
      let best: Tile | undefined;
      for (const n of neighbors(map, t)) if (!best || n.elev < best.elev) best = n;
      return best && best.elev < t.elev ? best.id : -1;
    });
  }

  private layout(): void {
    const map = this.map!;
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    const s3 = Math.sqrt(3);
    this.size = Math.max(2, Math.min(cw / ((map.w + 0.5) * s3), ch / (1.5 * map.h + 0.5)));
    this.ox = (cw - (map.w + 0.5) * s3 * this.size) / 2 + (s3 * this.size) / 2;
    this.oy = (ch - (1.5 * map.h + 0.5) * this.size) / 2 + this.size;
  }

  center(t: Tile): [number, number] {
    const s3 = Math.sqrt(3);
    return [this.ox + s3 * this.size * (t.col + (t.row & 1 ? 0.5 : 0)), this.oy + 1.5 * this.size * t.row];
  }

  pick(x: number, y: number): Tile | undefined {
    if (!this.map) return undefined;
    let best: Tile | undefined;
    let bd = Infinity;
    for (const t of this.map.tiles) {
      const [cx, cy] = this.center(t);
      const d = (cx - x) ** 2 + (cy - y) ** 2;
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return bd <= this.size * this.size * 1.2 ? best : undefined;
  }

  private hex(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 180) * (60 * i - 30);
      const x = cx + s * Math.cos(a);
      const y = cy + s * Math.sin(a);
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.closePath();
  }

  draw(world?: World): void {
    if (!this.map) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(cw * dpr) || this.canvas.height !== Math.round(ch * dpr)) {
      this.canvas.width = Math.round(cw * dpr);
      this.canvas.height = Math.round(ch * dpr);
    }
    this.layout();
    const ctx = this.canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    const s = this.size;
    const map = this.map;

    const layer = world ? this.overlay : 'terrain';
    const thematic = layer === 'stock' || layer === 'owner' || layer === 'density' || layer === 'fertility';
    const density = layer === 'density' && world ? densityByTile(world) : undefined;
    for (const t of map.tiles) {
      const [cx, cy] = this.center(t);
      this.hex(ctx, cx, cy, s + 0.5);
      // thematic layers colour land (and lakes, which hold fish, on the stock layer); water stays dimmed terrain
      if (!thematic || !(isLand(t) || (layer === 'stock' && t.terrain === 'lake'))) {
        ctx.fillStyle = TERRAIN_COLOR[t.terrain];
        if (thematic) ctx.globalAlpha = 0.5;
        ctx.fill();
        ctx.globalAlpha = 1;
        if (!thematic && t.plots > 0) {
          ctx.fillStyle = `rgba(240, 200, 60, ${Math.min(0.75, 0.2 + t.plots / Math.max(1, t.maxPlots))})`;
          ctx.fill();
        }
        continue;
      }
      if (layer === 'stock') {
        const r = stockRatio(t);
        ctx.fillStyle = Number.isNaN(r) ? NO_DATA : rampRYG(r);
      } else if (layer === 'owner') {
        ctx.fillStyle = t.owner >= 0 ? settlementColor(t.owner) : NO_DATA;
        if (t.owner >= 0) ctx.globalAlpha = 0.6;
      } else if (layer === 'density') {
        const d = density![t.id];
        ctx.fillStyle = d > 0 ? ramp(d / DENSITY_MAX, 20) : NO_DATA;
      } else {
        ctx.fillStyle = t.maxPlots > 0 ? ramp(t.fertility, 95) : NO_DATA;
      }
      ctx.fill();
      ctx.globalAlpha = 1;
      if (layer === 'fertility' && t.plots > 0) {
        this.hex(ctx, cx, cy, s * 0.45 * Math.sqrt(t.plots / Math.max(1, t.maxPlots)) + 1);
        ctx.fillStyle = 'rgba(240, 200, 60, 0.9)';
        ctx.fill();
      }
    }

    // territory tint
    if (world && !thematic) {
      for (const st of world.settlements) {
        if (!st.alive) continue;
        ctx.fillStyle = settlementColor(st.id);
        ctx.globalAlpha = this.selectedSettlement === st.id ? 0.35 : 0.18;
        for (const id of st.territory) {
          const [cx, cy] = this.center(map.tiles[id]);
          this.hex(ctx, cx, cy, s);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    }

    // rivers
    ctx.strokeStyle = '#4aa3e0';
    ctx.lineWidth = Math.max(1, s * 0.22);
    ctx.lineCap = 'round';
    for (const t of map.tiles) {
      const d = this.downstream[t.id];
      if (d < 0) continue;
      const [x1, y1] = this.center(t);
      const [x2, y2] = this.center(map.tiles[d]);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    if (layer === 'stock' && s >= 6) {
      ctx.font = `${Math.max(7, s * 0.8).toFixed(0)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const t of map.tiles) {
        if (!isLand(t)) continue;
        const marks: string[] = [];
        if (t.grain) marks.push('谷');
        if (t.animals) marks.push('畜');
        if (t.copper) marks.push('铜');
        if (t.tin) marks.push('锡');
        if (!marks.length) continue;
        const [cx, cy] = this.center(t);
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillText(marks[0], cx + 0.5, cy + 0.5);
        ctx.fillStyle = marks[0] === '铜' ? '#f0a060' : marks[0] === '锡' ? '#e0e0f0' : '#fff7d0';
        ctx.fillText(marks[0], cx, cy);
      }
    }

    if (world) {
      const cap = world.polity.capital;
      for (const st of world.settlements) {
        if (!st.alive) continue;
        const [cx, cy] = this.center(map.tiles[st.tile]);
        const r = Math.max(3, Math.min(s * 1.6, 2 + Math.sqrt(st.pop) * 0.45));
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = layer === 'owner' || !thematic ? settlementColor(st.id) : 'rgba(255,255,255,0.85)';
        ctx.fill();
        ctx.lineWidth = st.id === cap ? 2.5 : 1;
        ctx.strokeStyle = st.id === cap ? '#ffd54a' : 'rgba(0,0,0,0.7)';
        ctx.stroke();
        if (layer === 'institutions' && st.enforcement < world.params.enforceThreshold) {
          ctx.strokeStyle = '#ff5252';
          ctx.setLineDash([3, 2]);
          ctx.beginPath();
          ctx.arc(cx, cy, r + 3, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        if (this.selectedSettlement === st.id) {
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      if (s >= 7) {
        ctx.font = '11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (const st of world.settlements) {
          if (!st.alive) continue;
          const [cx, cy] = this.center(map.tiles[st.tile]);
          const r = Math.max(3, Math.min(s * 1.6, 2 + Math.sqrt(st.pop) * 0.45));
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fillText(st.name, cx + 1, cy + r + 2);
          ctx.fillStyle = '#fff';
          ctx.fillText(st.name, cx, cy + r + 1);
        }
      }
    }

    if (this.selectedTile >= 0) {
      const [cx, cy] = this.center(map.tiles[this.selectedTile]);
      this.hex(ctx, cx, cy, s);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
      if (!world) {
        // preview of the radius-2 home range on the setup screen
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, s * 2 * Math.sqrt(3) + s * 0.5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
}

/** People per tile: each settlement's population spread evenly over its territory. */
function densityByTile(world: World): Float32Array {
  const d = new Float32Array(world.map.tiles.length);
  for (const st of world.settlements) {
    if (!st.alive || !st.territory.length) continue;
    const v = st.pop / st.territory.length;
    for (const id of st.territory) d[id] += v;
  }
  return d;
}
