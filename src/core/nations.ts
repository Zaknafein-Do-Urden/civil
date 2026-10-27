// Multiple polities (DESIGN.md §12.2): per-polity state and polity-scoped world views.
//
// Every polity — the player's and the NPCs' — is simulated by the same code. That code was written
// for one polity and reads `world.people`, `world.polity`, `world.tech` and so on, so for each polity
// we build a view of the world in which only its own people and settlements exist (other polities'
// settlements appear dead), run the ordinary daily/monthly/yearly passes on the view, and write the
// results back. Tile ownership stays shared, so polities never settle on each other's land.

import { DIMS, optIndex } from './rules';
import { NOCC } from './types';
import { initTech } from './tech';
import type { CultureSetting, DimId } from './rules';
import { clamp } from './dmath';
import { hexDistance, isLand, siteScore, tilesWithin } from './map';
import type { Rng } from './rng';
import type { Person, Polity, PolityScope, World, YearAcc } from './types';

export const PLAYER = 0;

/** Band-society customs used where a culture leaves a dimension unspecified. */
const BAND_DEFAULT: Record<string, string> = {
  allocation: 'sharing', land: 'common', occupation: 'free', distribution: 'need', tax: 'none',
  authority: 'assembly', succession: 'prestige', inheritance: 'equal', speech: 'free',
};

export const emptyAcc = () => ({ foodProduced: 0, foodDecayed: 0, coldSum: 0, hungerDays: 0, personDays: 0 });
export const emptyYearAcc = (): YearAcc => ({ births: 0, deaths: 0, starved: 0, exiled: 0, hours: new Array<number>(NOCC).fill(0), workDays: new Array<number>(NOCC).fill(0) });


const NAME_A = '有熊虞夏商姜姬嬴姒妫风偃允祁己任芈曹董彭秃斟'.split('');
const NAME_B = '氏部族戎夷'.split('');

/** A name no other polity has had, so every people (named after its polity) is distinguishable. */
export function polityName(rng: Rng, taken: Set<string>): string {
  for (let i = 0; ; i++) {
    const name = rng.pick(NAME_A) + rng.pick(NAME_A) + rng.pick(NAME_B);
    if (!taken.has(name)) return name;
    if (i > 50) return name + (taken.size + 1);
  }
}

export function takenNames(world: World): Set<string> {
  return new Set(allPolities(world).map((p) => p.name));
}

export function scopeOf(world: World, id: number): PolityScope {
  return id === PLAYER ? world : world.npcs[id - 1];
}

export function polityOf(world: World, id: number): Polity {
  return scopeOf(world, id).polity;
}

export function allPolities(world: World): Polity[] {
  return [world.polity, ...world.npcs.map((n) => n.polity)];
}

export function polityColor(p: Polity, light = 55): string {
  return `hsl(${p.hue.toFixed(0)} 70% ${light}%)`;
}

function copyScope(dst: PolityScope, src: PolityScope): void {
  dst.polity = src.polity;
  dst.culture = src.culture;
  dst.tech = src.tech;
  dst.demand = src.demand;
  dst.researchAcc = src.researchAcc;
  dst.monthAcc = src.monthAcc;
  dst.lastMonth = src.lastMonth;
  dst.era = src.era;
  dst.stats = src.stats;
  dst.yearAcc = src.yearAcc;
}

/** People of a polity, in world order. */
export function peopleOf(world: World, id: number): Person[] {
  return world.people.filter((p) => world.settlements[p.settlement].polity === id);
}

/**
 * A world in which only polity `id` exists. Own settlements are the shared objects; foreign live
 * settlements are replaced by dead copies so every loop skips them. Read-only use (UI) needs no sync.
 */
export function polityView(world: World, id: number, people = peopleOf(world, id)): World {
  const settlements = world.settlements.map((s) => (s.polity === id || !s.alive ? s : { ...s, alive: false }));
  const v: World = { ...world, people, settlements };
  copyScope(v, scopeOf(world, id));
  return v;
}

/** Write a view's results back into the world. Returns the view's people. */
function syncBack(world: World, id: number, v: World, seq0: number): Person[] {
  copyScope(scopeOf(world, id), v);
  world.nextId = v.nextId;
  world.eventSeq = v.eventSeq;
  for (let i = world.settlements.length; i < v.settlements.length; i++) world.settlements.push(v.settlements[i]);
  if (v.notables !== world.notables) world.notables = v.notables;
  if (id !== PLAYER) {
    // an NPC's internal affairs are logged but never interrupt the player
    const name = v.polity.name;
    for (let i = world.events.length - 1; i >= 0 && world.events[i].seq >= seq0; i--) {
      const e = world.events[i];
      e.polity = id;
      e.major = false;
      e.title = `【${name}】${e.title}`;
    }
  }
  return v.people;
}

/** Run `fn` on one polity's view and merge the result. */
export function inPolity(world: World, id: number, fn: (v: World) => void): void {
  const mine: Person[] = [];
  const rest: Person[] = [];
  for (const p of world.people) (world.settlements[p.settlement].polity === id ? mine : rest).push(p);
  const v = polityView(world, id, mine);
  const seq0 = world.eventSeq;
  fn(v);
  world.people = [...rest, ...syncBack(world, id, v, seq0)];
}

/** Run `fn` on every polity that still has people, in id order. */
export function forEachPolity(world: World, fn: (v: World) => void): void {
  const n = 1 + world.npcs.length;
  const parts: Person[][] = [];
  for (let i = 0; i < n; i++) parts.push([]);
  for (const p of world.people) parts[world.settlements[p.settlement].polity].push(p);
  const out: Person[] = [];
  for (let id = 0; id < n; id++) {
    if (!parts[id].length) continue;
    const v = polityView(world, id, parts[id]);
    const seq0 = world.eventSeq;
    fn(v);
    for (const p of syncBack(world, id, v, seq0)) out.push(p);
  }
  world.people = out;
}

// --- NPC setup ----------------------------------------------------------

/** Best free site at least `minD` hexes from every living settlement. */
export function npcSite(world: World, minD: number): number {
  const live = world.settlements.filter((s) => s.alive).map((s) => world.map.tiles[s.tile]);
  let best = -1;
  let bs = -Infinity;
  for (const t of world.map.tiles) {
    if (!isLand(t) || t.owner >= 0) continue;
    let near = false;
    for (const o of live) {
      if (hexDistance(o, t) < minD) {
        near = true;
        break;
      }
    }
    if (near) continue;
    let free = 0;
    for (const n of tilesWithin(world.map, t, 2)) if (isLand(n) && n.owner < 0) free++;
    if (free < 14) continue;
    const s = siteScore(world.map, t, false);
    if (s > bs) {
      bs = s;
      best = t.id;
    }
  }
  return best;
}

/**
 * NPC culture: half the dimensions left to evolve, the rest random — but the closer to the player,
 * the likelier a dimension copies the player's setting (neighbouring peoples share customs).
 */
export function npcCulture(rng: Rng, player: CultureSetting, closeness: number): CultureSetting {
  const c = {} as CultureSetting;
  for (const d of DIMS) {
    const mine = player[d.id as DimId];
    if (mine && rng.chance(clamp(closeness, 0, 1) * 0.6)) c[d.id as DimId] = mine;
    else if (rng.chance(0.5)) c[d.id as DimId] = null;
    else c[d.id as DimId] = rng.pick(d.options).id;
  }
  return c;
}

/** Hue for polity `id`: the player is gold, NPCs spread around the wheel away from it. */
const NPC_HUES = [210, 350, 120, 280, 170, 315, 90, 250, 15, 145];

export function polityHue(id: number): number {
  return id === PLAYER ? 45 : NPC_HUES[(id - 1) % NPC_HUES.length] + Math.floor((id - 1) / NPC_HUES.length) * 7;
}

export function newScope(rng: Rng, id: number, culture: CultureSetting): PolityScope {
  return {
    polity: {
      id,
      name: '',
      hue: polityHue(id),
      alive: true,
      warMood: 0,
      leaderId: -1,
      leaderSince: 0,
      councilIds: [],
      capital: 0,
      treasury: { food: 0, tools: 0, clothes: 0 },
      legitimacy: 0.6,
      imports: { copper: 0, tin: 0 },
      metals: { copper: 1, tin: 1 },
      institutions: DIMS.map((d) => optIndex(d.id, culture[d.id] ?? BAND_DEFAULT[d.id])),
      active: DIMS.map((d) => d.id !== 'land'),
      dynasty: 1,
    },
    culture,
    tech: initTech(rng),
    demand: {},
    researchAcc: new Array(NOCC).fill(0),
    monthAcc: emptyAcc(),
    lastMonth: emptyAcc(),
    era: 0,
    stats: [],
    yearAcc: emptyYearAcc(),
  };
}
