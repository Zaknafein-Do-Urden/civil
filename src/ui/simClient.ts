// Main-thread handle on a simulation Worker: sends commands, keeps a read-only replica of its World.

import type { WorldConfig } from '../core/sim';
import type { Command, GameEvent, World, WorldMap } from '../core/types';
import { DYN_TILE_FIELDS } from './protocol';
import type { FromWorker, Snapshot, Status, StatsReply, ToWorker } from './protocol';

export interface SimHandlers {
  /** A fresh replica arrived (after `ready` or a requested snapshot). */
  onWorld?(world: World): void;
  onStatus?(status: Status): void;
  /** The Worker paused itself on these major events. */
  onMajor?(events: GameEvent[]): void;
  onError?(message: string): void;
}

export class SimClient {
  /** Latest replica; undefined until the Worker has built or loaded the world. */
  world: World | undefined;
  status: Status = { day: 0, running: false, rate: 0, pop: 0 };
  /** A snapshot request is outstanding. */
  pending = false;
  /** Time the last snapshot request was sent (performance.now()). */
  requested = 0;
  /** Main-thread milliseconds the last snapshot cost: decoding the message, unpacking and redrawing. */
  snapshotMs = 0;
  private readonly worker: Worker;
  private map: WorldMap | undefined;
  private history: World['tileHistory'] | undefined;
  private seq = 0;
  private readonly waiting = new Map<number, (json: string) => void>();
  private statsWaiting: ((r: StatsReply) => void)[] = [];

  constructor(public handlers: SimHandlers = {}) {
    this.worker = new Worker(new URL('./simWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const t0 = performance.now();
      const m = e.data; // decoded lazily, on first access
      this.receive(m);
      if (m.type === 'snapshot') this.snapshotMs = performance.now() - t0;
    };
    this.worker.onerror = (e) => this.handlers.onError?.(e.message);
  }

  private send(m: ToWorker): void {
    this.worker.postMessage(m);
  }

  private receive(m: FromWorker): void {
    switch (m.type) {
      case 'ready':
      case 'snapshot':
        this.pending = false;
        this.apply(m.snapshot);
        this.handlers.onWorld?.(this.world!);
        break;
      case 'status':
        this.status = m.status;
        this.handlers.onStatus?.(m.status);
        break;
      case 'major':
        this.status = m.status;
        this.handlers.onStatus?.(m.status);
        this.handlers.onMajor?.(m.events);
        break;
      case 'serialized': {
        const cb = this.waiting.get(m.id);
        this.waiting.delete(m.id);
        cb?.(m.json);
        break;
      }
      case 'stats': {
        const cbs = this.statsWaiting;
        this.statsWaiting = [];
        for (const cb of cbs) cb(m.reply);
        break;
      }
      case 'error':
        this.handlers.onError?.(m.message);
        break;
    }
  }

  private apply(s: Snapshot): void {
    if (s.map) this.map = s.map;
    if (s.tileHistory) this.history = s.tileHistory;
    const map = this.map!;
    const nf = DYN_TILE_FIELDS.length;
    const tiles = map.tiles;
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i] as unknown as Record<string, number>;
      for (let f = 0; f < nf; f++) t[DYN_TILE_FIELDS[f]] = s.tiles[i * nf + f];
    }
    this.world = { ...(JSON.parse(s.json) as Omit<World, 'map' | 'tileHistory'>), map, tileHistory: this.history! };
  }

  create(cfg: WorldConfig, quiet = false): void {
    this.send({ type: 'create', cfg, quiet });
  }

  load(json: string, quiet = false): void {
    this.send({ type: 'load', json, quiet });
  }

  control(running: boolean, speed: number, fastForward = false): void {
    this.send({ type: 'control', running, speed, fastForward });
  }

  runTo(day: number): void {
    this.send({ type: 'runTo', day });
  }

  issue(cmd: Command): void {
    this.send({ type: 'issue', cmd });
  }

  /** Ask for a fresh replica unless one is already on its way. */
  requestSnapshot(): void {
    if (this.pending) return;
    this.pending = true;
    this.requested = performance.now();
    this.send({ type: 'snapshot', full: false });
  }

  serialize(): Promise<string> {
    const id = ++this.seq;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.send({ type: 'serialize', id });
    });
  }

  stats(): Promise<StatsReply> {
    return new Promise((resolve) => {
      if (!this.statsWaiting.length) this.send({ type: 'stats' });
      this.statsWaiting.push(resolve);
    });
  }

  terminate(): void {
    this.worker.terminate();
  }
}
