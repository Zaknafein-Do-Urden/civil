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

export type Overlay = 'terrain' | 'resources' | 'institutions';

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

    for (const t of map.tiles) {
      const [cx, cy] = this.center(t);
      this.hex(ctx, cx, cy, s + 0.5);
      ctx.fillStyle = TERRAIN_COLOR[t.terrain];
      ctx.fill();
      if (t.plots > 0) {
        ctx.fillStyle = `rgba(240, 200, 60, ${Math.min(0.75, 0.2 + t.plots / Math.max(1, t.maxPlots))})`;
        ctx.fill();
      }
    }

    // territory tint
    if (world) {
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

    if (this.overlay === 'resources' && s >= 6) {
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
        ctx.fillStyle = settlementColor(st.id);
        ctx.fill();
        ctx.lineWidth = st.id === cap ? 2.5 : 1;
        ctx.strokeStyle = st.id === cap ? '#ffd54a' : 'rgba(0,0,0,0.7)';
        ctx.stroke();
        if (this.overlay === 'institutions' && st.enforcement < world.params.enforceThreshold) {
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
