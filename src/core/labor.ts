// Labor decisions, leisure, contribution reputation and exclusion (DESIGN.md §4.1).
// Each person chooses daily how many hours to work: the marginal benefit of an hour (the food it
// yields × the share that comes back to them × how much more food is worth to their household
// right now, plus the standing that visible work earns) against fatigue that rises with every hour.

import { clamp, exp, season } from './dmath';
import { ALLOC, D, DIST } from './rules';
import { addBio, ageYears, personById } from './person';
import { addEvent } from './events';
import { hexDistance } from './map';
import { findSite, newSettlement } from './demography';
import { OFF_SEASON, ageDays, aptitude, foodDecayRate, foodNeed, taxRate, toolMultiplier, workFactor } from './economy';
import type { FarmRight } from './economy';
import type { Rng } from './rng';
import { ADULT_AGE, DAYS_PER_MONTH, DAYS_PER_YEAR, NOCC, OCC } from './types';
import type { Person, Settlement, World } from './types';

const LN2 = 0.6931471805599453;

/** How accurately members see each other's contribution: 1/(1+(n/dunbar)²). */
export function observation(world: World, size: number): number {
  const r = size / world.params.dunbar;
  return 1 / (1 + r * r);
}

const adminCache = new WeakMap<World, { day: number; len: number; n: number }>();

/** Share of shirking that officials see: admins per head, discounted by distance from the capital. */
export function supervision(world: World, s: Settlement): number {
  let c = adminCache.get(world);
  if (!c || c.day !== world.day || c.len !== world.people.length) {
    let n = 0;
    for (const p of world.people) if (p.occ === OCC.admin) n++;
    c = { day: world.day, len: world.people.length, n };
    adminCache.set(world, c);
  }
  return clamp(((c.n * 40) / Math.max(1, world.people.length)) * s.enforcement, 0, 1);
}

/** Growing-season factor for a settlement's home tile on a given day (0 in winter). */
export function growingFactor(world: World, s: Settlement, day: number): number {
  const temp = world.map.tiles[s.tile].temp + world.params.climateShift + 12 * season(day % DAYS_PER_YEAR);
  return clamp((temp - 5) / 15, 0, 1) / 0.55;
}

/** Days in the year without a harvest: farmers must store this much ahead (if food keeps that long). */
export function leanDays(world: World, s: Settlement): number {
  let n = 0;
  for (let m = 0; m < 12; m++) if (growingFactor(world, s, m * DAYS_PER_MONTH + 15) < OFF_SEASON) n++;
  return n * DAYS_PER_MONTH;
}

/** How much the settlement's culture values visible generosity: mean adult preference for sharing. */
function generosityCulture(world: World, people: Person[]): number {
  let g = 0;
  let n = 0;
  for (const p of people) {
    if (ageDays(world, p) < ADULT_AGE * DAYS_PER_YEAR) continue;
    g += p.prefs[D.allocation][ALLOC.sharing];
    n++;
  }
  return n ? g / n : 0.3;
}

/** Fraction of food received from the common pool, given one's reputation (conditional reciprocity). */
export function repShare(world: World, p: Person): number {
  return clamp(1 - world.params.reciprocity * Math.max(0, 1 - p.reputation), 0.3, 1);
}

/**
 * Daily choice of work hours for everyone in a settlement.
 * `yields` is food value per hour per unit of aptitude for each occupation today; farm yields are
 * scaled by the season and by `farmMP`, the marginal return of more hours on the land at hand.
 */
export function decideHours(world: World, s: Settlement, people: Person[], yields: number[], growing: number,
  farmMP: number, farmRights: Map<number, FarmRight>): void {
  const P = world.params;
  const alloc = s.practiced[D.allocation];
  const pooled = alloc !== ALLOC.exchange;
  const dist = s.practiced[D.distribution];
  const n = Math.max(1, people.length);
  let needTotal = 0;
  for (const p of people) needTotal += foodNeed(world, p);
  const poolDays = pooled ? s.food / Math.max(1, needTotal) : 0;
  const acc = observation(world, n);
  const sup = alloc === ALLOC.command ? supervision(world, s) : 0;
  // what others' eyes add to one's own share of a pooled hour
  const watched = Math.max(acc * P.reciprocity, sup * P.punishment);
  const decay = foodDecayRate(world);
  const horizon = 1 / Math.max(1e-4, decay);
  const lean = leanDays(world, s);
  const g = pooled ? generosityCulture(world, people) : 0;
  const tax = taxRate(world, s);
  for (const p of people) {
    const wf = workFactor(ageDays(world, p));
    // away on campaign: no work at home (war.ts)
    if (p.occ < 0 || wf <= 0 || p.health < 0.2 || p.away > world.day) {
      p.hours = 0;
      continue;
    }
    // food (value) one more hour yields. Without a market, crafts, research and office are valued
    // by the community like an hour of gathering; with one, crafts earn what their goods fetch.
    // In the off season farmers forage.
    const craft = p.occ === OCC.tool || p.occ === OCC.tailor;
    const offSeason = p.occ === OCC.farm && growing < OFF_SEASON;
    const occ = p.occ === OCC.tinker || p.occ === OCC.admin || (craft && pooled) || offSeason ? OCC.gather : p.occ;
    const y = yields[occ] * (occ === OCC.farm ? growing * farmMP : 1) *
      aptitude(world, p, occ) * toolMultiplier(world, p) * (0.5 + 0.5 * p.health) * p.effort * wf;
    // share of that hour's output that comes back to the worker: private land overrides pooling
    const right = occ === OCC.farm ? farmRights.get(p.id) : undefined;
    const ownFarm = right === 'own';
    let share: number;
    if (!pooled || ownFarm) {
      share = (1 - tax) * (right === 'chief' ? 0.7 : right === 'tenant' ? 0.6 : 1);
    } else {
      // the hungry eat part of what they gather before it reaches the common store
      const own = 1 / n + (dist === DIST.labor ? 0.3 : 0) + (dist === DIST.rank && p.role !== 'none' ? 0.2 : 0);
      share = own + (1 - own) * Math.max(watched, p.hunger);
    }
    // household stores in days; food beyond what will keep is worth little
    let hhFood = p.food;
    let hhNeed = foodNeed(world, p);
    const sp = personById(world, p.spouseId);
    if (sp && sp.settlement === p.settlement) {
      hhFood += sp.food;
      hhNeed += foodNeed(world, sp);
    }
    for (const id of p.childIds) {
      const k = personById(world, id);
      if (k && k.settlement === p.settlement && ageDays(world, k) < ADULT_AGE * DAYS_PER_YEAR) {
        hhFood += k.food;
        hhNeed += foodNeed(world, k);
      }
    }
    const S = hhFood / hhNeed + (pooled && !ownFarm ? poolDays : 0);
    const T = Math.min(horizon, P.bufferDays + (p.occ === OCC.farm ? lean : 0));
    let value = exp(-decay * S) * (1 + 2 * p.hunger + 1.5 * clamp(1 - S / Math.max(1, T), 0, 1));
    if (!pooled) value += P.wealthStatus * p.ambition;
    let benefit = y * share * value;
    if (pooled) benefit += P.generosity * g * acc * (0.5 + p.ambition) * y;
    const cost = P.fatigue * exp(LN2 * (1 - 2 * p.diligence)) * (2 - p.health);
    p.hours = clamp(benefit / cost, 0, P.maxHours);
    world.yearAcc.hours[p.occ] += p.hours;
    world.yearAcc.workDays[p.occ]++;
  }
}

/** Monthly: work intensity, reputation from observed contribution, outsiders earning standing. */
export function updateLabor(world: World, rng: Rng, s: Settlement, people: Person[]): void {
  const P = world.params;
  const pooled = s.practiced[D.allocation] !== ALLOC.exchange;
  const acc = observation(world, people.length);
  // the norm is judged per age: youths and elders are expected to do less
  let sum = 0;
  let cnt = 0;
  for (const p of people) {
    const wf = workFactor(ageDays(world, p));
    if (p.occ < 0 || wf <= 0) continue;
    sum += p.avgHours / wf;
    cnt++;
  }
  const norm = Math.max(0.5, sum / Math.max(1, cnt));
  for (const p of people) {
    p.effort = clamp(1 - 0.2 * p.grievance, 0.5, 1);
    const wf = workFactor(ageDays(world, p));
    const working = p.occ >= 0 && wf > 0;
    if (!working || p.health < 0.5 || p.away > world.day - DAYS_PER_MONTH) {
      // children, the old, the sick and those away at war are excused
      p.reputation = p.reputation * 0.9 + 0.1;
    } else {
      // in a big group contributions blur into the average, and gossip adds noise
      const seen = acc * (p.avgHours / wf / norm) + (1 - acc) + rng.normal() * 0.2 * (1 - acc);
      p.reputation = clamp(p.reputation * 0.85 + clamp(seen, 0, 2) * 0.15, 0, 1.5);
    }
    if (p.outsider && p.reputation >= 0.95) {
      p.outsider = false;
      addBio(world, p, '在新聚落赢得了认可');
    }
    const adult = ageDays(world, p) >= ADULT_AGE * DAYS_PER_YEAR;
    p.lowRepMonths = pooled && adult && working && p.reputation < P.exileRep ? p.lowRepMonths + 1 : 0;
  }
}

/** Long-standing shirkers in pooled settlements are driven out. Returns true if anyone left. */
export function exclusion(world: World, rng: Rng, s: Settlement, people: Person[], groups: Person[][]): boolean {
  const P = world.params;
  if (s.practiced[D.allocation] === ALLOC.exchange) return false;
  const cands = people.filter((p) => p.lowRepMonths >= P.exileMonths && p.role === 'none');
  if (!cands.length) return false;
  const leaving = new Set<number>();
  const households: Person[][] = [];
  for (const p of cands) {
    if (leaving.has(p.id)) continue;
    const hh = [p];
    leaving.add(p.id);
    const sp = personById(world, p.spouseId);
    const spouseGoes = !!sp && sp.settlement === s.id && sp.role === 'none' && !leaving.has(sp.id) &&
      (sp.reputation < P.exileRep * 1.3 || rng.chance(0.6));
    if (sp && spouseGoes) {
      hh.push(sp);
      leaving.add(sp.id);
    }
    // minor children go with the exile unless the other parent stays to keep them
    for (const id of p.childIds) {
      const k = personById(world, id);
      if (!k || k.settlement !== s.id || leaving.has(k.id) || ageYears(world, k) >= ADULT_AGE) continue;
      if (spouseGoes || !sp || sp.settlement !== s.id || p.sex === 0) {
        hh.push(k);
        leaving.add(k.id);
      }
    }
    households.push(hh);
  }
  const all = households.flat();
  const here = world.map.tiles[s.tile];
  const names = households.map((h) => h[0].name).join('、');
  const leave = (p: Person, dest: Settlement, outsider: boolean) => {
    p.settlement = dest.id;
    p.plots = 0;
    p.lowRepMonths = 0;
    if (outsider) {
      p.outsider = true;
      p.reputation = Math.min(p.reputation, P.outsiderRep);
      p.prestige *= 0.5;
    } else p.reputation = 1;
  };
  // enough outcasts together may found their own camp
  if (all.filter((p) => ageYears(world, p) >= ADULT_AGE).length >= 4) {
    const site = findSite(world, s.tile, 3, 7);
    if (site >= 0) {
      const ns = newSettlement(world, rng, site);
      ns.practiced = [...s.practiced];
      ns.toolPrice = s.toolPrice;
      ns.clothesPrice = s.clothesPrice;
      for (const p of all) leave(p, ns, false);
      for (const p of all) addBio(world, p, `被${s.name}排挤，与同伴另立营地${ns.name}`);
      world.yearAcc.exiled += all.length;
      addEvent(world, 'settlement', false, `排挤：${s.name} → ${ns.name}`,
        `${names}等长期不出力，被${s.name}排挤，${all.length} 人另立营地${ns.name}。`, households.map((h) => h[0].id), ns.id);
      return true;
    }
  }
  let moved = 0;
  for (const hh of households) {
    let dest: Settlement | undefined;
    let bestD = Infinity;
    for (const o of world.settlements) {
      if (!o.alive || o.id === s.id) continue;
      const m = groups[o.id]?.length ?? 0;
      if (m === 0 || m > P.dunbar * 1.5) continue;
      const d = hexDistance(here, world.map.tiles[o.tile]);
      if (d <= 10 && d < bestD) {
        bestD = d;
        dest = o;
      }
    }
    if (!dest) {
      // nowhere to go at home: tolerated, unless a neighbouring people takes them in (crossborder.ts)
      continue;
    }
    for (const p of hh) leave(p, dest, true);
    addBio(world, hh[0], `长期不出力，被${s.name}排挤，投奔${dest.name}`);
    moved += hh.length;
  }
  if (moved) {
    world.yearAcc.exiled += moved;
    addEvent(world, 'settlement', false, `排挤：${s.name}`, `${names}等长期不出力，被${s.name}排挤，共 ${moved} 人投奔别的聚落，在那里是外来者。`,
      households.map((h) => h[0].id), s.id);
  }
  return moved > 0;
}

/** Saves from before the labor model: fill in the new fields. */
export function migrateLabor(world: World): void {
  for (const sc of [world, ...(world.npcs ?? [])]) {
    sc.yearAcc.exiled ??= 0;
    sc.yearAcc.hours ??= new Array<number>(NOCC).fill(0);
    sc.yearAcc.workDays ??= new Array<number>(NOCC).fill(0);
  }
  for (const p of world.people) {
    p.diligence ??= 0.5;
    p.hours ??= 6;
    p.hoursAcc ??= 0;
    p.avgHours ??= 6;
    p.reputation ??= 1;
    p.lowRepMonths ??= 0;
    p.outsider ??= false;
    p.away ??= 0;
  }
}
