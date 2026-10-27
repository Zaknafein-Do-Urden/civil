// Production, ownership of output, distribution, consumption, markets and job choice (DESIGN.md §4).

import { clamp, season } from './dmath';
import { ALLOC, D, DIST, LAND, OCCSEL, SPEECH, TAX_RATES } from './rules';
import { has } from './tech';
import { personById } from './person';
import { collection, localRuler, splitTax } from './control';
import { decideHours, growingFactor, repShare } from './labor';
import type { Rng } from './rng';
import { ADULT_AGE, DAYS_PER_YEAR, NOCC, NO_OCC, OCC } from './types';
import type { Person, Settlement, World } from './types';

// Ability weights per occupation: [physical, math, social]
const ABILITY_W: number[][] = [
  [0.4, 0.1, 0],
  [0.8, 0.1, 0.2],
  [0.5, 0.2, 0],
  [0.3, 0.6, 0],
  [0.2, 0.4, 0],
  [0.6, 0.2, 0],
  [0.5, 0.1, 0.1],
  [0, 1.2, 0.1],
  [0, 0.6, 0.7],
];

const FOOD_OCCS = [OCC.gather, OCC.hunt, OCC.fish, OCC.farm, OCC.herd];
/** Growing-season factor below which farmers have nothing to do in the fields. */
export const OFF_SEASON = 0.1;

export function ageDays(world: World, p: Person): number {
  return world.day - p.birth;
}

export function workFactor(ageD: number): number {
  const y = ageD / DAYS_PER_YEAR;
  if (y < 12) return 0;
  if (y < 16) return 0.5;
  if (y < 55) return 1;
  if (y < 65) return 0.8;
  if (y < 72) return 0.5;
  return 0;
}

export function foodNeed(world: World, p: Person): number {
  const y = ageDays(world, p) / DAYS_PER_YEAR;
  const n = world.params.foodNeedAdult;
  return y < 12 ? n * 0.6 : y > 60 ? n * 0.8 : n;
}

/** Ability and skill multiplier for a person in an occupation (no effort, tools or resources). */
export function aptitude(world: World, p: Person, occ: number): number {
  const w = ABILITY_W[occ];
  const a = (w[0] * (p.physical - 50) + w[1] * (p.math - 50) + w[2] * (p.social - 50)) / 50;
  return Math.max(0.2, 1 + world.params.abilityWeight * a) * (1 + 0.6 * p.skills[occ]);
}

export function toolDurability(world: World): number {
  return (has(world, 'ground_stone') ? 1.5 : 1) * (has(world, 'bronze') ? 1.5 : 1);
}

export function toolMultiplier(world: World, p: Person): number {
  const bonus = world.params.toolBonus * (has(world, 'copper') ? 1.5 : 1) * (has(world, 'bronze') ? 1.5 : 1);
  return 1 + bonus * p.toolCond;
}

/** Share of stored food that spoils each day. */
export function foodDecayRate(world: World): number {
  return world.params.foodDecay * (has(world, 'pottery') ? 0.4 : 1);
}

/** Tax the people of `s` actually pay: whoever collects it, centre or local ruler (control.ts). */
export function taxRate(world: World, s: Settlement): number {
  return TAX_RATES[s.practiced[D.tax]] * collection(world, s);
}

function tileTempToday(world: World, temp: number): number {
  return temp + 12 * season(world.day % DAYS_PER_YEAR);
}

/** Occupations a settlement can currently support. */
export function occAvailable(world: World, s: Settlement, occ: number): boolean {
  switch (occ) {
    case OCC.fish:
      return has(world, 'fishing') && s.territory.some((id) => world.map.tiles[id].fishCap > 0);
    case OCC.farm:
      return has(world, 'agriculture') && s.territory.some((id) => world.map.tiles[id].maxPlots > 0);
    case OCC.herd:
      return has(world, 'husbandry') && s.territory.some((id) => world.map.tiles[id].animals);
    case OCC.admin:
      return false; // appointed by the leader, never chosen
    default:
      return true;
  }
}

function resourceDensity(world: World, s: Settlement, key: 'plants' | 'game' | 'fish'): { stock: number; cap: number } {
  let stock = 0;
  let cap = 0;
  const capKey = (key + 'Cap') as 'plantsCap' | 'gameCap' | 'fishCap';
  for (const id of s.territory) {
    const t = world.map.tiles[id];
    stock += t[key];
    cap += t[capKey];
  }
  // lakes adjacent to territory also count for fishing
  return { stock, cap };
}

function harvest(world: World, s: Settlement, key: 'plants' | 'game' | 'fish', amount: number): void {
  if (amount <= 0) return;
  let stock = 0;
  for (const id of s.territory) stock += world.map.tiles[id][key];
  if (stock <= 0) return;
  const f = Math.min(1, amount / stock);
  for (const id of s.territory) world.map.tiles[id][key] *= 1 - f;
}

/** Expected output value (food units) per working hour per unit of aptitude, per occupation, in this settlement. */
export function occYield(world: World, s: Settlement): number[] {
  const P = world.params;
  const y = new Array<number>(NOCC).fill(0);
  const pl = resourceDensity(world, s, 'plants');
  const gm = resourceDensity(world, s, 'game');
  const fs = resourceDensity(world, s, 'fish');
  const huntMul = (has(world, 'spear_thrower') ? 1.3 : 1) * (has(world, 'bow') ? 1.4 : 1);
  y[OCC.gather] = P.gatherRate * Math.min(1, (pl.stock / (pl.cap || 1)) * 1.2);
  y[OCC.hunt] = P.huntRate * huntMul * Math.min(1, (gm.stock / (gm.cap || 1)) * 1.2);
  y[OCC.fish] = fs.cap > 0 ? P.fishRate * (has(world, 'boats') ? 1.3 : 1) * Math.min(1, (fs.stock / fs.cap) * 1.2) : 0;
  y[OCC.farm] = P.farmRate * farmMultiplier(world, s) * avgFertility(world, s);
  y[OCC.herd] = P.herdRate * pastureFactor(world, s);
  y[OCC.tool] = P.toolRate * stoneFactor(world, s) * s.toolPrice;
  y[OCC.tailor] = P.clothesRate * (has(world, 'bone_needle') ? 1.5 : 1) * s.clothesPrice;
  return y;
}

function farmMultiplier(world: World, s: Settlement): number {
  let m = 1;
  if (has(world, 'calendar')) m *= 1.2;
  if (has(world, 'plough')) m *= 1.4;
  if (has(world, 'irrigation') && world.map.tiles[s.tile].river) m *= 1.5;
  return m;
}

function avgFertility(world: World, s: Settlement): number {
  let f = 0;
  let n = 0;
  for (const id of s.territory) {
    const t = world.map.tiles[id];
    if (t.maxPlots > 0) {
      f += t.fertility;
      n++;
    }
  }
  return n ? f / n : 0;
}

function pastureFactor(world: World, s: Settlement): number {
  let n = 0;
  for (const id of s.territory) if (world.map.tiles[id].animals) n++;
  return Math.min(1, 0.4 + n * 0.2);
}

function stoneFactor(world: World, s: Settlement): number {
  let best = 0;
  for (const id of s.territory) best = Math.max(best, world.map.tiles[id].stone);
  return 0.5 + best * 0.5;
}

export function totalPlots(world: World, s: Settlement): number {
  let n = 0;
  for (const id of s.territory) n += world.map.tiles[id].plots;
  return n;
}

function maxPlots(world: World, s: Settlement): number {
  let n = 0;
  for (const id of s.territory) n += world.map.tiles[id].maxPlots;
  return n;
}

function clearPlots(world: World, s: Settlement, amount: number): number {
  let left = amount;
  for (const id of s.territory) {
    const t = world.map.tiles[id];
    const room = t.maxPlots - t.plots;
    if (room <= 0) continue;
    const add = Math.min(room, left);
    t.plots += add;
    left -= add;
    if (left <= 0) break;
  }
  return amount - left;
}

// --- daily -------------------------------------------------------------

/** One day of production and consumption for a settlement. */
export function dailySettlement(world: World, rng: Rng, s: Settlement, people: Person[]): void {
  const P = world.params;
  const alloc = s.practiced[D.allocation];
  const pooled = alloc !== ALLOC.exchange;
  const tax = taxRate(world, s);
  const treasury = world.polity.treasury;
  // the further from the centre, the less of the tax goes up; the local ruler keeps part for his family
  const lord = localRuler(world, s);
  const [toCentre, toLord, toPool] = splitTax(world, s, lord);
  const acc = world.researchAcc;

  // Farming: clear new plots when there are more farmers than plots; settle who farms which land
  const isFarmer = (p: Person) => p.occ === OCC.farm && p.health >= 0.2 && workFactor(ageDays(world, p)) > 0;
  let farmers = 0;
  let farmHours = 0;
  for (const p of people) {
    if (!isFarmer(p)) continue;
    farmers++;
    farmHours += p.avgHours;
  }
  let plots = totalPlots(world, s);
  // new land is cleared before existing fields are worked ever harder (extensive before intensive)
  const want = Math.max(farmers, farmHours / (P.farmLabor * 0.5));
  if (want > plots && plots < maxPlots(world, s)) {
    const cleared = clearPlots(world, s, Math.max(0.02, (want - plots) * 0.01));
    plots += cleared;
    homestead(world, s, people, cleared);
  }
  const farmRights = farmTenure(world, s, people, isFarmer);

  // 1. Everyone chooses today's hours; potential output per occupation (in worker-hours × aptitude).
  // More hours on the same land bring diminishing returns (intensification).
  const yields = occYield(world, s);
  const growing = growingFactor(world, s, world.day);
  const intensity = plots > 0 ? farmHours / plots : 0;
  const farmMP = 1 / ((1 + intensity / P.farmLabor) * (1 + intensity / P.farmLabor));
  decideHours(world, s, people, yields, growing, farmMP, farmRights);
  // in the off season farmers forage and hunt
  const offSeason = growing < OFF_SEASON;
  const wocc = people.map((p) => (p.occ === OCC.farm && offSeason ? OCC.gather : p.occ));
  const potential = new Array<number>(NOCC).fill(0);
  const pot = new Array<number>(people.length).fill(0);
  for (let i = 0; i < people.length; i++) {
    const p = people[i];
    p.hoursAcc += p.hours;
    // leisure: some of it goes into tinkering and curiosity, more so for the mathematically gifted
    if (ageDays(world, p) >= ADULT_AGE * DAYS_PER_YEAR) {
      acc[OCC.tinker] += P.leisureResearch * ((P.maxHours - p.hours) / 8) * (p.math / 50) * (p.math / 50);
    }
    if (p.occ < 0 || p.hours <= 0) continue;
    const wf = workFactor(ageDays(world, p));
    const h8 = p.hours / 8;
    const o = wocc[i];
    const v = aptitude(world, p, o) * p.effort * wf * (0.5 + 0.5 * p.health) * toolMultiplier(world, p) * p.hours;
    pot[i] = v;
    potential[o] += v;
    p.skills[o] += P.skillGain * h8 * (1 - p.skills[o]);
    acc[o] += (0.5 + p.skills[o]) * (0.5 + p.math / 100) * p.effort * wf * h8;
    if (p.occ === OCC.tinker) acc[OCC.tinker] += (p.math / 50) * (p.math / 50) * p.effort * h8;
  }

  // 2. Actual output, limited by the environment
  const actual = new Array<number>(NOCC).fill(0);
  const pl = resourceDensity(world, s, 'plants');
  const gm = resourceDensity(world, s, 'game');
  const fs = resourceDensity(world, s, 'fish');
  actual[OCC.gather] = Math.min(potential[OCC.gather] * yields[OCC.gather], pl.stock * 0.5);
  harvest(world, s, 'plants', actual[OCC.gather]);
  actual[OCC.hunt] = Math.min(potential[OCC.hunt] * yields[OCC.hunt], gm.stock * 0.5);
  harvest(world, s, 'game', actual[OCC.hunt]);
  actual[OCC.fish] = Math.min(potential[OCC.fish] * yields[OCC.fish], fs.stock * 0.5);
  harvest(world, s, 'fish', actual[OCC.fish]);

  const t0 = world.map.tiles[s.tile];
  const perPlot = plots > 0 ? potential[OCC.farm] / plots : 0;
  actual[OCC.farm] = yields[OCC.farm] * growing * plots * (perPlot / (1 + perPlot / P.farmLabor));
  actual[OCC.herd] = potential[OCC.herd] * yields[OCC.herd];

  s.hides += actual[OCC.hunt] * 0.05 + actual[OCC.herd] * 0.03;
  actual[OCC.tool] = potential[OCC.tool] * P.toolRate * stoneFactor(world, s);
  let clothes = potential[OCC.tailor] * P.clothesRate * (has(world, 'bone_needle') ? 1.5 : 1);
  if (!has(world, 'weaving')) {
    clothes = Math.min(clothes, s.hides);
    s.hides -= clothes;
  }
  actual[OCC.tailor] = clothes;
  world.monthAcc.foodProduced += actual[OCC.gather] + actual[OCC.hunt] + actual[OCC.fish] + actual[OCC.farm] + actual[OCC.herd];

  // 3. Ownership of output
  for (let i = 0; i < people.length; i++) {
    const p = people[i];
    const o = wocc[i];
    if (pot[i] <= 0 || potential[o] <= 0) continue;
    const out = (actual[o] * pot[i]) / potential[o];
    if (out <= 0) continue;
    const isFood = o !== OCC.tool && o !== OCC.tailor;
    p.outputAcc += isFood ? out : out * (o === OCC.tool ? s.toolPrice : s.clothesPrice);
    // Private farmland overrides pooling: owners keep their harvest
    const ownFarm = o === OCC.farm && farmRights.get(p.id) === 'own';
    let keep = out * (1 - tax);
    const taxed = out * tax;
    if (o === OCC.farm) {
      const right = farmRights.get(p.id);
      if (right === 'chief') {
        const tribute = keep * 0.3;
        keep -= tribute;
        treasury.food += tribute;
      } else if (right === 'tenant') {
        keep -= payRent(world, s, people, keep * 0.4);
      }
    }
    if (taxed > 0) {
      if (isFood) {
        treasury.food += taxed * toCentre;
        s.food += taxed * toPool;
        if (lord) lord.food += taxed * toLord;
        s.skimAcc += taxed * toLord;
      } else if (o === OCC.tool) {
        treasury.tools += taxed * toCentre;
        s.tools += taxed * toPool;
        if (lord) lord.tools += taxed * toLord;
        s.skimAcc += taxed * toLord * s.toolPrice;
      } else {
        treasury.clothes += taxed * toCentre;
        s.clothes += taxed * toPool;
        if (lord) lord.clothes += taxed * toLord;
        s.skimAcc += taxed * toLord * s.clothesPrice;
      }
    }
    if (pooled && !ownFarm) {
      // the hungry eat part of their own catch on the spot
      const eaten = isFood ? keep * p.hunger : 0;
      p.food += eaten;
      keep -= eaten;
      if (isFood) s.food += keep;
      else if (o === OCC.tool) s.tools += keep;
      else s.clothes += keep;
    } else {
      if (isFood) p.food += keep;
      else if (o === OCC.tool) p.tools += keep;
      else p.clothes += keep;
    }
  }

  // 4. Distribution of the communal pool
  distributePool(world, s, people);

  // 5. Consumption, tools, clothes, cold
  const tempToday = tileTempToday(world, t0.temp);
  const coldness = clamp((8 - tempToday) / 20, 0, 1.5);
  const shelter = has(world, 'mudbrick') ? 0.6 : 1;
  const dur = toolDurability(world);
  // the best-provisioned neighbour is who the starving turn to
  let patron: Person | undefined;
  for (const p of people) if (!patron || p.food > patron.food) patron = p;
  for (const p of people) if (workFactor(ageDays(world, p)) < 1) eat(world, s, p, patron);
  for (const p of people) if (workFactor(ageDays(world, p)) >= 1) eat(world, s, p, patron);
  for (const p of people) {
    if (p.occ >= 0) {
      p.toolCond = Math.max(0, p.toolCond - 1 / (120 * dur));
      if (p.toolCond < 0.5) {
        if (p.tools >= 1) {
          p.tools -= 1;
          p.toolCond = 1;
        } else if (s.tools >= 1 && pooled) {
          s.tools -= 1;
          p.toolCond = 1;
        }
      }
    }
    p.clothesCond = Math.max(0, p.clothesCond - 1 / 200);
    if (p.clothesCond < 0.5) {
      if (p.clothes >= 1) {
        p.clothes -= 1;
        p.clothesCond = 1;
      } else if (s.clothes >= 1 && pooled) {
        s.clothes -= 1;
        p.clothesCond = 1;
      }
    }
    const stress = coldness * (1 - 0.85 * p.clothesCond) * shelter;
    p.cold = p.cold * 0.97 + stress * 0.03;
    world.monthAcc.coldSum += stress;
    world.monthAcc.personDays++;
    if (stress > 0.05) p.health -= P.coldDamage * stress;
  }

  // 6. Spoilage
  const decay = foodDecayRate(world);
  world.monthAcc.foodDecayed += s.food * decay;
  s.food *= 1 - decay;
  for (const p of people) {
    world.monthAcc.foodDecayed += p.food * decay;
    p.food *= 1 - decay;
  }
  void rng;
}

export type FarmRight = 'own' | 'common' | 'chief' | 'tenant';

/** Who farms which kind of land today: owners first, then commons, chief's land, then tenancy. */
function farmTenure(world: World, s: Settlement, people: Person[], isFarmer: (p: Person) => boolean): Map<number, FarmRight> {
  const rights = new Map<number, FarmRight>();
  const plots = totalPlots(world, s);
  let privateOwned = 0;
  for (const p of people) privateOwned += p.plots;
  let common = Math.max(0, plots - privateOwned - s.chiefPlots);
  let chief = Math.min(s.chiefPlots, plots);
  let rentable = 0;
  for (const p of people) rentable += Math.max(0, p.plots - (p.occ === OCC.farm ? 1 : 0));
  for (const p of people) {
    if (!isFarmer(p)) continue;
    if (p.plots >= 1) rights.set(p.id, 'own');
    else if (common >= 1) {
      rights.set(p.id, 'common');
      common--;
    } else if (chief >= 1) {
      rights.set(p.id, 'chief');
      chief--;
    } else if (rentable >= 1) {
      rights.set(p.id, 'tenant');
      rentable--;
    } else rights.set(p.id, 'common');
  }
  return rights;
}

function payRent(world: World, s: Settlement, people: Person[], amount: number): number {
  let excess = 0;
  for (const p of people) excess += Math.max(0, p.plots - (p.occ === OCC.farm ? 1 : 0));
  if (excess <= 0) return 0;
  for (const p of people) {
    const e = Math.max(0, p.plots - (p.occ === OCC.farm ? 1 : 0));
    if (e > 0) p.food += (amount * e) / excess;
  }
  void world;
  void s;
  return amount;
}

/** Newly cleared land goes to the clearer (private), the chief, or stays common. */
function homestead(world: World, s: Settlement, people: Person[], cleared: number): void {
  const land = s.practiced[D.land];
  if (land === LAND.chief) {
    s.chiefPlots += cleared;
  } else if (land === LAND.private) {
    const landless = people.filter((p) => p.occ === OCC.farm && p.plots < 1);
    const target = landless.length ? landless : people.filter((p) => p.occ === OCC.farm);
    if (!target.length) return;
    const each = cleared / target.length;
    for (const p of target) p.plots += each;
  }
  void world;
}

function rankWeight(p: Person): number {
  if (p.role === 'leader') return 4;
  if (p.role === 'council' || p.role === 'governor') return 2.5;
  if (p.role === 'chief') return 2;
  if (p.occ === OCC.admin) return 1.8;
  return 1 + clamp(p.prestige, 0, 2) * 0.15;
}

function distributePool(world: World, s: Settlement, people: Person[]): void {
  if (!people.length) return;
  const rule = s.practiced[D.distribution];
  const pooled = s.practiced[D.allocation] !== ALLOC.exchange;
  // In exchange settlements the pool only relieves the hungry (inheritance, charity)
  const needs = people.map((p) => Math.max(0, foodNeed(world, p) - (pooled ? 0 : p.food)));
  let total = 0;
  for (const n of needs) total += n;
  if (total <= 0) return;
  if (s.food >= total) {
    for (let i = 0; i < people.length; i++) people[i].food += needs[i];
    s.food -= total;
    if (pooled && rule === DIST.rank) {
      // elites draw extra into personal stores
      for (let i = 0; i < people.length; i++) {
        const extra = needs[i] * (rankWeight(people[i]) - 1);
        if (extra > 0 && s.food > total * 30) {
          people[i].food += extra;
          s.food -= extra;
        }
      }
    } else if (pooled && rule === DIST.labor && s.food > total * 60) {
      let out = 0;
      for (const p of people) out += p.output;
      if (out > 0) {
        const bonus = s.food * 0.002;
        for (const p of people) p.food += (bonus * p.output) / out;
        s.food -= bonus;
      }
    }
    return;
  }
  // Rationing by rule; in pooled settlements those seen not doing their share get less (conditional reciprocity)
  const w = people.map((p, i) => {
    const r = pooled ? repShare(world, p) : 1;
    switch (rule) {
      case DIST.equal: return needs[i] > 0 ? r : 0;
      case DIST.need: return needs[i] * r;
      case DIST.labor: return needs[i] * 0.4 * r + p.output * 0.6;
      default: return needs[i] * rankWeight(p) * r;
    }
  });
  let wsum = 0;
  for (const x of w) wsum += x;
  if (wsum <= 0) return;
  const pool = s.food;
  for (let i = 0; i < people.length; i++) {
    const give = Math.min((pool * w[i]) / wsum, needs[i] * (rule === DIST.rank ? rankWeight(people[i]) : 1.5));
    people[i].food += give;
    s.food -= give;
  }
}

function eat(world: World, s: Settlement, p: Person, patron: Person | undefined): void {
  const need = foodNeed(world, p);
  let got = Math.min(p.food, need);
  p.food -= got;
  const minor = workFactor(ageDays(world, p)) < 1;
  if (got < need) {
    // household (spouse, parents, guardian) shares down to the giver's own meal; grown children keep a small reserve
    const household = [p.spouseId, p.motherId, p.fatherId, p.guardianId];
    const kin = [...household, ...p.childIds];
    for (let i = 0; i < kin.length; i++) {
      if (got >= need) break;
      const k = personById(world, kin[i]);
      if (!k || k.settlement !== s.id) continue;
      // children eat first and get a fair slice of the household larder; adults keep their own meal
      const spare = i >= household.length ? k.food - foodNeed(world, k) * 2
        : minor ? (k.food * foodNeed(world, p)) / (foodNeed(world, k) + foodNeed(world, p) * Math.max(1, k.childIds.length) / 2)
        : k.food - foodNeed(world, k);
      if (spare <= 0) continue;
      const give = Math.min(spare, need - got);
      k.food -= give;
      got += give;
    }
  }
  if (got < need) {
    // public relief from the treasury when culture of the settlement provides for need/equality
    const rule = s.practiced[D.distribution];
    if ((rule === DIST.need || rule === DIST.equal) && world.polity.treasury.food > 0) {
      const give = Math.min(world.polity.treasury.food, (need - got) * s.enforcement);
      world.polity.treasury.food -= give;
      got += give;
    }
  }
  if (got < need && patron && patron !== p && (minor || p.hunger > 0.3)) {
    // hospitality: nobody in a small community watches a neighbour starve, but how much they give depends on culture
    const spare = patron.food - foodNeed(world, patron) * 60;
    if (spare > 0) {
      // children are fed regardless; adults get help according to the giver's sharing ethic
      const give = Math.min(spare, need - got) * (minor ? 1 : 0.3 + 0.7 * patron.prefs[D.allocation][ALLOC.sharing]);
      patron.food -= give;
      got += give;
    }
  }
  const deficit = (need - got) / need;
  if (deficit > 0.05) {
    p.hunger = Math.min(1, p.hunger * 0.9 + deficit * 0.2);
    p.health -= world.params.starvationDamage * deficit;
    world.monthAcc.hungerDays += deficit;
  } else {
    p.hunger *= 0.9;
    p.health = Math.min(1, p.health + 0.01);
  }
}

// --- monthly -----------------------------------------------------------

/** Monthly market for tools and clothes, priced in food. */
export function market(world: World, rng: Rng, s: Settlement, people: Person[]): void {
  for (const good of ['tools', 'clothes'] as const) {
    const cond = good === 'tools' ? 'toolCond' : 'clothesCond';
    const priceKey = good === 'tools' ? 'toolPrice' : 'clothesPrice';
    const incomeKey = good === 'tools' ? 'toolIncome' : 'clothesIncome';
    const makerOcc = good === 'tools' ? OCC.tool : OCC.tailor;
    const buyers = people.filter((p) => p[cond] < 0.6 && p[good] < 1 && p.food > foodNeed(world, p) * 10 + s[priceKey]);
    // makers keep one unit for themselves and sell the rest
    const sellers = people.filter((p) => p[good] >= 2);
    let supply = 0;
    for (const p of sellers) supply += Math.floor(p[good] - 1);
    const ratio = (buyers.length + 1) / (supply + 1);
    s[priceKey] = clamp(s[priceKey] * Math.sqrt(clamp(ratio, 0.5, 2)), 1, 300);
    buyers.sort((a, b) => b.food - a.food || a.id - b.id);
    let si = 0;
    let revenue = 0;
    for (const b of buyers) {
      while (si < sellers.length && sellers[si][good] < 2) si++;
      if (si >= sellers.length) break;
      const price = s[priceKey];
      if (b.food < price) continue;
      b.food -= price;
      b[good] += 1;
      sellers[si].food += price;
      sellers[si][good] -= 1;
      revenue += price;
      if (rng.chance(0.5)) si++;
      if (si >= sellers.length) si = 0;
    }
    const makers = people.filter((p) => p.occ === makerOcc).length;
    // with no makers, people can only guess from the price what the trade would pay
    s[incomeKey] = makers > 0 ? revenue / 30 / makers : Math.min(buyers.length, 5) * s[priceKey] / 30 / 2;
  }
}

/** Desired number of workers per occupation for a settlement, as a planner would compute it. */
export function targetCounts(world: World, rng: Rng, s: Settlement, people: Person[], noise: number): number[] {
  const P = world.params;
  const workers = people.filter((p) => workFactor(ageDays(world, p)) > 0);
  const n = workers.length;
  const t = new Array<number>(NOCC).fill(0);
  if (!n) return t;
  let need = 0;
  for (const p of people) need += foodNeed(world, p);
  const foodDays = s.food / Math.max(1, need);
  const y = occYield(world, s);
  const dur = toolDurability(world);
  // tools and clothes in units per day, workers needed at average aptitude and the usual hours
  let hrs = 0;
  for (const p of workers) hrs += p.avgHours;
  const day = Math.max(1, hrs / n);
  const toolDemand = n / (120 * dur) + Math.max(0, n * 0.3 - s.tools) / 120;
  t[OCC.tool] = toolDemand / Math.max(0.001, P.toolRate * stoneFactor(world, s) * day);
  const coldClimate = clamp((12 - world.map.tiles[s.tile].temp) / 15, 0.15, 1);
  const clothesDemand = (people.length / 200) * coldClimate + Math.max(0, people.length * 0.2 - s.clothes) / 200;
  t[OCC.tailor] = clothesDemand / Math.max(0.001, P.clothesRate * (has(world, 'bone_needle') ? 1.5 : 1) * day);
  const surplus = clamp(foodDays / 60 - 0.5, 0, 1);
  t[OCC.tinker] = n * 0.03 * surplus * (0.5 + maxDemand(world));
  // the rest produce food, split across the most productive food occupations
  const foodWorkers = Math.max(0, n - t[OCC.tool] - t[OCC.tailor] - t[OCC.tinker]);
  const avail = FOOD_OCCS.filter((o) => occAvailable(world, s, o) && y[o] > 0);
  const ys = avail.map((o) => y[o] * y[o]);
  const ysum = ys.reduce((a, b) => a + b, 0) || 1;
  avail.forEach((o, i) => (t[o] = (foodWorkers * ys[i]) / ysum));
  if (noise > 0) {
    for (let o = 0; o < NOCC; o++) t[o] = Math.max(0, t[o] * (1 + noise * rng.normal()));
  }
  return t;
}

export function maxDemand(world: World): number {
  let m = 0;
  for (const k in world.demand) m = Math.max(m, world.demand[k]);
  return m;
}

/** Planner noise: worse with less able planners, controlled speech and distance from the capital. */
export function plannerNoise(world: World, s: Settlement, plannerMath: number): number {
  const P = world.params;
  const speech = s.practiced[D.speech];
  const speechF = speech === SPEECH.free ? 0.6 : speech === SPEECH.limited ? 1 : 1.6;
  const tech = (has(world, 'tally') ? 0.7 : 1) * (has(world, 'writing') ? 0.6 : 1);
  const quality = clamp(plannerMath / 100, 0, 1);
  return P.planNoise * (1.3 - quality) * speechF * tech * (1 + s.distance / (P.baseReach * 2));
}

/** Monthly occupation choice according to the practiced allocation and occupation rules. */
export function chooseJobs(world: World, rng: Rng, s: Settlement, people: Person[], plannerMath: number, tinkerFunds: number): void {
  const alloc = s.practiced[D.allocation];
  const occSel = s.practiced[D.occupation];
  const avail = Array.from({ length: NOCC }, (_, o) => occAvailable(world, s, o));
  const workers = people.filter((p) => p.occ !== OCC.admin && workFactor(ageDays(world, p)) > 0);
  for (const p of people) if (workFactor(ageDays(world, p)) <= 0 && p.occ !== OCC.admin) p.occ = NO_OCC;

  if (occSel === OCCSEL.hereditary) {
    for (const p of workers) {
      if (p.occ >= 0 && avail[p.occ]) continue;
      if (p.parentOcc >= 0 && avail[p.parentOcc] && p.parentOcc !== OCC.admin) p.occ = p.parentOcc;
      else p.occ = bestFoodOcc(world, s, p, avail);
    }
    return;
  }

  if (alloc === ALLOC.command || occSel === OCCSEL.assigned) {
    const noise = plannerNoise(world, s, plannerMath);
    const target = targetCounts(world, rng, s, people, noise);
    assign(world, rng, s, workers, target, avail, clamp(plannerMath / 100 + 0.3, 0, 1));
    return;
  }

  if (alloc === ALLOC.sharing) {
    // A small band knows its own needs well and people pitch in where they are most useful.
    const target = targetCounts(world, rng, s, people, 0.15);
    assign(world, rng, s, workers, target, avail, 0.85);
    return;
  }

  // Exchange with free choice: each person chases the best expected income. Incomes fall as
  // more people crowd into the same line of work this month (depleting game, flooding the market).
  const values = occYield(world, s);
  // craft income only counts what actually sold last month (per day, so per usual working hour)
  let hrs = 0;
  for (const p of workers) hrs += p.avgHours;
  const day = Math.max(1, hrs / Math.max(1, workers.length));
  values[OCC.tool] = s.toolIncome / day;
  values[OCC.tailor] = s.clothesIncome / day;
  const base = new Array<number>(NOCC).fill(0);
  for (const p of workers) if (p.occ >= 0) base[p.occ]++;
  const live = [...base];
  const income = (o: number) => {
    if (o === OCC.tinker) return tinkerFunds / 30 / day / (live[o] + 1);
    return values[o] / (1 + Math.max(0, live[o] - base[o]) / Math.max(5, base[o]));
  };
  for (const p of workers) {
    if (p.occ >= 0 && !rng.chance(0.35)) continue;
    const cur = p.occ >= 0 && avail[p.occ] ? p.occ : -1;
    if (cur >= 0) live[cur]--;
    let best = cur;
    let bestV = cur >= 0 ? income(cur) * occApt(world, p, cur) * 1.15 : -Infinity;
    for (let o = 0; o < NOCC; o++) {
      if (!avail[o] || o === cur) continue;
      const v = income(o) * occApt(world, p, o) * (1 + 0.15 * rng.normal());
      if (v > bestV) {
        best = o;
        bestV = v;
      }
    }
    p.occ = best >= 0 ? best : OCC.gather;
    live[p.occ]++;
  }
}

function occApt(world: World, p: Person, o: number): number {
  return o === OCC.tinker ? (p.math / 50) * (p.math / 50) : aptitude(world, p, o);
}

function bestFoodOcc(world: World, s: Settlement, p: Person, avail: boolean[]): number {
  const y = occYield(world, s);
  let best: number = OCC.gather;
  let bv = -1;
  for (const o of FOOD_OCCS) {
    if (!avail[o]) continue;
    const v = y[o] * aptitude(world, p, o);
    if (v > bv) {
      bv = v;
      best = o;
    }
  }
  return best;
}

/** Planner assignment: keep fitting incumbents, then fill shortages by comparative advantage. */
function assign(world: World, rng: Rng, s: Settlement, workers: Person[], target: number[], avail: boolean[], quality: number): void {
  const want = target.map((t, o) => (avail[o] ? Math.round(t) : 0));
  let wantSum = want.reduce((a, b) => a + b, 0);
  // fit counts to the workforce
  while (wantSum > workers.length) {
    let o = want.indexOf(Math.max(...want));
    want[o]--;
    wantSum--;
  }
  const counts = new Array<number>(NOCC).fill(0);
  const free: Person[] = [];
  const fit = (p: Person) => (p.occ >= 0 ? aptitude(world, p, p.occ) : 0);
  const sorted = [...workers].sort((a, b) => fit(b) - fit(a) || a.id - b.id);
  for (const p of sorted) {
    if (p.occ >= 0 && counts[p.occ] < want[p.occ]) counts[p.occ]++;
    else free.push(p);
  }
  for (let o = 0; o < NOCC; o++) {
    while (counts[o] < want[o] && free.length) {
      let idx = 0;
      if (rng.chance(quality)) {
        let bv = -Infinity;
        for (let i = 0; i < free.length; i++) {
          const v = aptitude(world, free[i], o) / avgApt(world, free[i]);
          if (v > bv) {
            bv = v;
            idx = i;
          }
        }
      } else idx = rng.int(free.length);
      free[idx].occ = o;
      free.splice(idx, 1);
      counts[o]++;
    }
  }
  for (const p of free) p.occ = bestFoodOcc(world, s, p, avail);
}

function avgApt(world: World, p: Person): number {
  let s = 0;
  for (const o of FOOD_OCCS) s += aptitude(world, p, o);
  return s / FOOD_OCCS.length;
}

/** Rich people (exchange) fund tinkerers in proportion to their surplus and how pressing needs are. */
export function patronage(world: World, s: Settlement, people: Person[]): number {
  const P = world.params;
  const tinkers = people.filter((p) => p.occ === OCC.tinker);
  let fund = 0;
  for (const p of people) {
    const reserve = foodNeed(world, p) * 90;
    if (p.food > reserve) {
      const give = (p.food - reserve) * P.patronShare * (0.5 + maxDemand(world));
      p.food -= give;
      fund += give;
    }
  }
  if (tinkers.length) for (const t of tinkers) t.food += fund / tinkers.length;
  else s.food += fund;
  return fund;
}

/** Wealthy people with a sharing culture help hungry neighbours. */
export function charity(world: World, people: Person[]): void {
  const hungry = people.filter((p) => p.hunger > 0.2);
  if (!hungry.length) return;
  for (const p of people) {
    const reserve = foodNeed(world, p) * 60;
    if (p.food <= reserve) continue;
    const give = (p.food - reserve) * 0.3 * p.prefs[D.allocation][ALLOC.sharing];
    p.food -= give;
    for (const h of hungry) h.food += give / hungry.length;
  }
}

export function wealth(p: Person, s: Settlement | undefined): number {
  const tp = s ? s.toolPrice : 5;
  const cp = s ? s.clothesPrice : 8;
  return p.food + p.tools * tp + p.clothes * cp + p.plots * 150;
}

/** Reference points for "relative output" (among workers) and "relative wealth" (among adults). */
export function settlementAverages(world: World, s: Settlement, people: Person[]): { avgOut: number; avgWealth: number } {
  let out = 0;
  let workers = 0;
  let w = 0;
  let adults = 0;
  for (const p of people) {
    const age = ageDays(world, p);
    if (workFactor(age) > 0 && p.occ >= 0) {
      out += p.output;
      workers++;
    }
    if (age >= ADULT_AGE * DAYS_PER_YEAR) {
      w += wealth(p, s);
      adults++;
    }
  }
  return { avgOut: out / Math.max(1, workers) || 1, avgWealth: w / Math.max(1, adults) || 1 };
}

export function regenTiles(world: World): void {
  const P = world.params;
  const sd = season(world.day % DAYS_PER_YEAR);
  for (const t of world.map.tiles) {
    if (t.plantsCap <= 0 && t.gameCap <= 0 && t.fishCap <= 0) continue;
    const temp = t.temp + 12 * sd;
    const g = clamp((temp - 2) / 15, 0, 1) * (0.4 + 0.6 * t.rain);
    // farmland displaces wild plants and game
    const wild = t.maxPlots > 0 ? 1 - (t.plots / Math.max(1, t.maxPlots)) * 0.7 : 1;
    if (t.plantsCap > 0) {
      const K = t.plantsCap * wild;
      t.plants += P.plantRegen * g * 2 * t.plants * (1 - t.plants / K) + 0.002 * K * g;
      if (t.plants > K) t.plants = K;
    }
    if (t.gameCap > 0) {
      const K = t.gameCap * wild;
      t.game += P.gameRegen * t.game * (1 - t.game / K) + 0.001 * K;
      if (t.game > K) t.game = K;
    }
    if (t.fishCap > 0) {
      t.fish += 0.02 * t.fish * (1 - t.fish / t.fishCap) + 0.001 * t.fishCap;
      if (t.fish > t.fishCap) t.fish = t.fishCap;
    }
  }
}

export { FOOD_OCCS };
