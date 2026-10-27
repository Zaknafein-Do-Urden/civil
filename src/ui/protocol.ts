// Messages between the main thread and a simulation Worker (simWorker.ts, simClient.ts).
// The Worker owns the World; the main thread keeps a read-only replica refreshed from snapshots.

import type { WorldConfig } from '../core/sim';
import type { Command, GameEvent, World, YearStats } from '../core/types';

/** Tile fields that change during a game; everything else on a tile is fixed at map generation. */
export const DYN_TILE_FIELDS = ['plants', 'plantsCap', 'game', 'gameCap', 'fish', 'fishCap', 'fertility', 'owner', 'plots', 'maxPlots'] as const;

export type ToWorker =
  | { type: 'create'; cfg: WorldConfig; quiet?: boolean }
  | { type: 'load'; json: string; quiet?: boolean }
  /** Run at `speed` days per second, or as fast as possible until the next major event (`fastForward`). */
  | { type: 'control'; running: boolean; speed: number; fastForward: boolean }
  /** Comparison runs: advance as fast as possible until `day`, then wait. */
  | { type: 'runTo'; day: number }
  | { type: 'issue'; cmd: Command }
  | { type: 'snapshot'; full: boolean }
  | { type: 'serialize'; id: number }
  | { type: 'stats' };

export interface Status {
  day: number;
  running: boolean;
  /** Days actually simulated per second over the last second. */
  rate: number;
  pop: number;
}

/**
 * The World without its map and tile history, as JSON (parsing JSON is several times cheaper than
 * structured-cloning the same objects), plus the dynamic tile fields packed into a transferable array.
 * The static map and an unchanged tile history are only sent when needed.
 */
export interface Snapshot {
  json: string;
  map?: World['map'];
  tileHistory?: World['tileHistory'];
  /** DYN_TILE_FIELDS.length values per tile, tile-major. */
  tiles: Float64Array;
}

export interface StatsReply {
  day: number;
  name: string;
  pop: number;
  legitimacy: number;
  techs: number;
  stats: YearStats[];
}

export type FromWorker =
  | { type: 'ready'; snapshot: Snapshot }
  | { type: 'error'; message: string }
  | { type: 'status'; status: Status }
  /** The Worker paused itself on these major events. */
  | { type: 'major'; events: GameEvent[]; status: Status }
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'serialized'; id: number; json: string }
  | { type: 'stats'; reply: StatsReply };
