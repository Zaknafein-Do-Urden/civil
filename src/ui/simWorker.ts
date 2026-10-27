// Simulation Worker: owns one World and advances it off the main thread (DESIGN.md §8.4).
// The main thread drives it with control messages and pulls snapshots for display (protocol.ts).

import { createWorld, deserialize, issue, serialize, step } from '../core/sim';
import { PLAYER, peopleOf } from '../core/nations';
import type { World } from '../core/types';
import { DYN_TILE_FIELDS } from './protocol';
import type { FromWorker, Snapshot, Status, ToWorker } from './protocol';

/** Longest stretch of simulation between two looks at the message queue, ms. */
const SLICE = 40;

let world: World | undefined;
/** Comparison runs never pause on major events. */
let quiet = false;
let running = false;
let speed = 1;
let fastForward = false;
/** Comparison runs advance up to this day, as fast as they can. */
let target = -1;
let acc = 0;
let lastSeq = 0;
let lastTick = 0;
let rateStamp = 0;
let rateDays = 0;
let rate = 0;
let lastStatus = 0;
let sentHistoryDay = -2;
let timer: ReturnType<typeof setTimeout> | undefined;

const post = (m: FromWorker, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

function status(): Status {
  const w = world!;
  return { day: w.day, running: running || target > w.day, rate, pop: w.people.length };
}

function snapshot(full: boolean): Snapshot {
  const w = world!;
  const tiles = w.map.tiles;
  const nf = DYN_TILE_FIELDS.length;
  const packed = new Float64Array(tiles.length * nf);
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    for (let f = 0; f < nf; f++) packed[i * nf + f] = t[DYN_TILE_FIELDS[f]];
  }
  const h = w.tileHistory;
  const histDay = h.days.length ? h.days[h.days.length - 1] : -1;
  const sendHistory = full || histDay !== sentHistoryDay;
  sentHistoryDay = histDay;
  const { map, tileHistory, ...rest } = w;
  return { json: JSON.stringify(rest), map: full ? map : undefined, tileHistory: sendHistory ? tileHistory : undefined, tiles: packed };
}

function sendSnapshot(type: 'ready' | 'snapshot', full: boolean): void {
  const s = snapshot(full);
  post({ type, snapshot: s }, [s.tiles.buffer]);
}

function schedule(): void {
  if (timer !== undefined) return;
  const active = !!world && world.people.length > 0 && (running || target > world.day);
  if (active) timer = setTimeout(tick, 0);
}

function tick(): void {
  timer = undefined;
  const w = world;
  if (!w) return;
  const now = performance.now();
  const dt = lastTick ? Math.min(100, now - lastTick) : 16;
  lastTick = now;
  let steps = 0;
  if (running && w.people.length) {
    if (!fastForward) acc += (speed * dt) / 1000;
    while ((fastForward || acc >= 1) && w.people.length && performance.now() - now < SLICE) {
      step(w);
      steps++;
      if (!fastForward) acc -= 1;
      if (w.eventSeq !== lastSeq && checkMajor(w)) break;
    }
    if (acc > speed) acc = speed; // don't build an unbounded backlog when the sim can't keep up
  } else {
    while (target > w.day && w.people.length && performance.now() - now < SLICE) {
      step(w);
      steps++;
      lastSeq = w.eventSeq;
    }
  }
  rateDays += steps;
  if (now - rateStamp > 1000) {
    rate = (rateDays * 1000) / (now - rateStamp);
    rateDays = 0;
    rateStamp = now;
  }
  if (steps && now - lastStatus > 50) {
    lastStatus = now;
    post({ type: 'status', status: status() });
  }
  if (!w.people.length && running) {
    running = false;
    post({ type: 'status', status: status() });
  }
  schedule();
}

/** New events since the last step: pause on major ones unless this is a quiet comparison run. */
function checkMajor(w: World): boolean {
  const fresh = w.events.filter((e) => e.seq >= lastSeq);
  lastSeq = w.eventSeq;
  const major = quiet ? [] : fresh.filter((e) => e.major);
  if (!major.length) return false;
  running = false;
  fastForward = false;
  post({ type: 'major', events: major, status: status() });
  return true;
}

function start(w: World): void {
  world = w;
  lastSeq = w.eventSeq;
  running = false;
  acc = 0;
  target = -1;
  sentHistoryDay = -2;
  sendSnapshot('ready', true);
  post({ type: 'status', status: status() });
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  try {
    switch (m.type) {
      case 'create':
        quiet = !!m.quiet;
        start(createWorld(m.cfg));
        break;
      case 'load':
        quiet = !!m.quiet;
        start(deserialize(m.json));
        break;
      case 'control':
        running = m.running;
        speed = m.speed;
        fastForward = m.running && m.fastForward;
        lastTick = 0;
        rateStamp = performance.now();
        rateDays = 0;
        if (!running) acc = 0;
        if (world) post({ type: 'status', status: status() });
        break;
      case 'runTo':
        target = m.day;
        break;
      case 'issue':
        if (world) issue(world, m.cmd);
        break;
      case 'snapshot':
        if (world) sendSnapshot('snapshot', m.full);
        break;
      case 'serialize':
        if (world) post({ type: 'serialized', id: m.id, json: serialize(world) });
        break;
      case 'stats':
        if (world) {
          post({
            type: 'stats',
            reply: {
              day: world.day, name: world.polity.name, pop: peopleOf(world, PLAYER).length,
              legitimacy: world.polity.legitimacy, techs: world.tech.known.filter(Boolean).length, stats: world.stats,
            },
          });
        }
        break;
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
  schedule();
};
