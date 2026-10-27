// Births, marriage, death and inheritance, settlement fission (DESIGN.md §3.4).

import { clamp, pow } from './dmath';
import { D, INH } from './rules';
import { addBio, ageYears, createChild, personById } from './person';
import { addEvent } from './events';
import { isLand, moveCost, neighbors, siteScore, tilesWithin, hexDistance } from './map';
import { has } from './tech';
import { tileCapacity } from './tiles';
import { epidemicRisk, huntRisk } from './disease';
import type { Rng } from './rng';
import { ADULT_AGE, DAYS_PER_YEAR, OCC } from './types';
import type { Person, Settlement, World } from './types';

const SETTLEMENT_NAMES = '溪石林泉谷坡湾岗原台洲坪滩营寨堡渡坞'.split('');
const SETTLEMENT_PREFIX = '东西南北青白赤黑金银松柏枫柳桃杏鹿熊鹰狼龙虎石河湖山'.split('');

export function settlementName(rng: Rng): string {
  return rng.pick(SETTLEMENT_PREFIX) + rng.pick(SETTLEMENT_NAMES);
}

/**
 * Background yearly death rate by age, close to observed foragers (Gurven & Kaplan 2007) minus the causes
 * modelled on their own: hunting accidents, epidemics, war, hunger and cold.
 */
function yearlyMortality(age: number): number {
  if (age < 1) return 0.12;
  if (age < 5) return 0.025;
  if (age < 15) return 0.005;
  if (age < 40) return 0.006;
  if (age < 60) return 0.012 + (age - 40) * 0.0008;
  return 0.035 * pow(1.09, age - 60);
}

export interface DeathRecord {
  person: Person;
  cause: string;
}

/** Daily births and deaths. Returns the people who died today (already removed from the world). */
export function dailyDemography(world: World, rng: Rng, groups: Person[][]): DeathRecord[] {
  const P = world.params;
  const dead: DeathRecord[] = [];
  const born: Person[] = [];
  for (const p of world.people) {
    const age = ageYears(world, p);
    let q = (yearlyMortality(age) * P.baseMortality) / DAYS_PER_YEAR;
    if (p.health < 0.5) q += (0.5 - p.health) * 0.02;
    const s = world.settlements[p.settlement];
    const qe = epidemicRisk(world, s, p, age);
    if (qe > 0 && rng.chance(qe)) {
      s.epiDeaths++;
      dead.push({ person: p, cause: '死于疫病' });
      continue;
    }
    const qh = huntRisk(world, p);
    if (qh > 0 && rng.chance(qh)) {
      dead.push({ person: p, cause: rng.pick(['狩猎时被野兽所伤而死', '狩猎时坠崖身亡', '狩猎途中溺亡']) });
      continue;
    }
    if (p.health <= 0 || rng.chance(q)) {
      const cause = p.hunger > 0.4 ? '饿死' : p.cold > 0.3 ? '冻死' : age < 5 ? '夭折' : age > 55 ? '老死' : '病故';
      dead.push({ person: p, cause });
      continue;
    }
    // births
    if (p.sex === 0 && p.spouseId >= 0 && age >= ADULT_AGE && age < 45) {
      const husband = personById(world, p.spouseId);
      if (!husband || husband.settlement !== p.settlement) continue;
      const sedentary = p.occ === OCC.farm || husband.occ === OCC.farm || p.occ === OCC.herd || husband.occ === OCC.herd;
      const spacing = sedentary ? 540 : 900;
      if (world.day - p.lastBirth < spacing) continue;
      const nutrition = clamp(1 - p.hunger * 2, 0, 1) * p.health;
      if (rng.chance((P.fertility * nutrition * (sedentary ? 1.25 : 1)) / DAYS_PER_YEAR)) {
        const child = createChild(world, rng, p, husband);
        p.lastBirth = world.day;
        p.childIds.push(child.id);
        husband.childIds.push(child.id);
        born.push(child);
      }
    }
  }
  if (born.length) {
    world.people.push(...born);
    for (const c of born) groups[c.settlement]?.push(c);
    world.yearAcc.births += born.length;
  }
  if (dead.length) {
    const ids = new Set(dead.map((d) => d.person.id));
    for (const d of dead) handleDeath(world, d.person, d.cause);
    world.people = world.people.filter((p) => !ids.has(p.id));
    for (let i = 0; i < groups.length; i++) if (groups[i]) groups[i] = groups[i].filter((p) => !ids.has(p.id));
    world.yearAcc.deaths += dead.length;
    world.yearAcc.starved += dead.filter((d) => d.cause === '饿死' || d.cause === '冻死').length;
  }
  return dead;
}

/** Deaths outside the daily pass (battle): bury, settle inheritance, and remove from the world. */
export function killPeople(world: World, victims: Person[], cause: string): void {
  if (!victims.length) return;
  const ids = new Set(victims.map((p) => p.id));
  for (const p of victims) handleDeath(world, p, cause);
  world.people = world.people.filter((p) => !ids.has(p.id));
}

function handleDeath(world: World, p: Person, cause: string): void {
  const spouse = personById(world, p.spouseId);
  if (spouse) spouse.spouseId = -1;
  addBio(world, p, `${cause}，享年 ${Math.floor(ageYears(world, p))} 岁`);
  if (p.notable) {
    world.notables.push({ id: p.id, name: p.name, birth: p.birth, death: world.day, bio: p.bio });
    if (world.notables.length > 500) world.notables.shift();
  }
  adoptOrphans(world, p);
  // Inheritance
  const s = world.settlements[p.settlement];
  const rule = s ? s.practiced[D.inheritance] : INH.equal;
  const kids = p.childIds.map((id) => personById(world, id)).filter((k): k is Person => !!k && k.id !== p.id);
  let heirs: Person[] = [];
  if (rule === INH.equal) {
    heirs = [...kids];
    if (spouse) heirs.push(spouse);
  } else if (rule === INH.primogeniture) {
    const sons = kids.filter((k) => k.sex === 1).sort((a, b) => a.birth - b.birth);
    const eldest = sons[0] ?? [...kids].sort((a, b) => a.birth - b.birth)[0] ?? spouse;
    if (eldest) heirs = [eldest];
  }
  if (heirs.length) {
    const n = heirs.length;
    for (const h of heirs) {
      h.food += p.food / n;
      h.tools += p.tools / n;
      h.clothes += p.clothes / n;
      h.plots += p.plots / n;
    }
  } else if (s) {
    // collective, or nobody to inherit: goes to the community; land becomes common
    s.food += p.food;
    s.tools += p.tools;
    s.clothes += p.clothes;
  }
}

/** Minor children who lose their last caring adult are taken in by an adult sibling or a well-off neighbour. */
function adoptOrphans(world: World, dead: Person): void {
  const isMinor = (k: Person) => ageYears(world, k) < ADULT_AGE;
  const living = (id: number) => {
    const x = personById(world, id);
    return x && x.id !== dead.id && x.settlement === dead.settlement ? x : undefined;
  };
  const wards = world.people.filter((k) => isMinor(k) && (k.motherId === dead.id || k.fatherId === dead.id || k.guardianId === dead.id));
  for (const k of wards) {
    if (living(k.motherId) || living(k.fatherId) || (k.guardianId !== dead.id && living(k.guardianId))) continue;
    assignGuardian(world, k, dead.id);
  }
}

export function assignGuardian(world: World, k: Person, exclude = -1): void {
  const siblings = world.people.filter((x) => x.id !== exclude && x.settlement === k.settlement && !(ageYears(world, x) < ADULT_AGE) &&
    ((k.motherId >= 0 && x.motherId === k.motherId) || (k.fatherId >= 0 && x.fatherId === k.fatherId)));
  let g = siblings[0];
  if (!g) {
    for (const x of world.people) {
      if (x.id === exclude || x.settlement !== k.settlement || ageYears(world, x) < 20) continue;
      if (!g || x.food > g.food) g = x;
    }
  }
  k.guardianId = g ? g.id : -1;
}

/** Monthly matchmaking within each settlement. */
export function marriages(world: World, rng: Rng, people: Person[]): void {
  const singles = people.filter((p) => p.spouseId < 0 && ageYears(world, p) >= ADULT_AGE && ageYears(world, p) < 50);
  const women = rng.shuffle(singles.filter((p) => p.sex === 0));
  const men = rng.shuffle(singles.filter((p) => p.sex === 1));
  // Assortative by prestige and standing as a contributor, with randomness
  const key = (p: Person) => p.prestige + (p.reputation - 1) * 1.5 + rng.next() * 0.8;
  const wk = women.map((p) => [key(p), p] as const).sort((a, b) => b[0] - a[0] || a[1].id - b[1].id);
  const mk = men.map((p) => [key(p), p] as const).sort((a, b) => b[0] - a[0] || a[1].id - b[1].id);
  const n = Math.min(wk.length, mk.length);
  for (let i = 0; i < n; i++) {
    const w = wk[i][1];
    const m = mk[i][1];
    // nobody wants to marry someone known as a shirker
    if (!rng.chance(0.15 * clamp(Math.min(w.reputation, m.reputation), 0.2, 1))) continue;
    if (w.fatherId >= 0 && w.fatherId === m.fatherId) continue;
    w.spouseId = m.id;
    m.spouseId = w.id;
  }
}

// --- settlements -------------------------------------------------------

/** Daily foraging wades across rivers and fishes lakes, so it moves like travel with boats. */
const FORAGE_TECH = { boats: true, wheel: false, sailing: false };

/**
 * How far members range from home each day, in travel cost (one plains tile = 1), by how the settlement
 * feeds itself: foragers walk about 10 km, farmers about 5 km to their fields, herders follow pasture.
 */
export function rangeBudget(world: World, people: Person[]): number {
  const P = world.params;
  let wild = 0;
  let farm = 0;
  let herd = 0;
  for (const p of people) {
    if (p.occ === OCC.farm) farm++;
    else if (p.occ === OCC.herd) herd++;
    else if (p.occ === OCC.gather || p.occ === OCC.hunt || p.occ === OCC.fish) wild++;
  }
  const n = wild + farm + herd;
  return n ? (wild * P.forageRange + farm * P.farmRange + herd * P.herdRange) / n : P.forageRange;
}

/**
 * Territory = unclaimed (or own) tiles reachable from the centre within the daily range, by terrain travel
 * cost: hills, forests and rivers shrink it, open plains widen it. Cleared farmland is kept even when the
 * range shrinks; tiles no longer used are released for others.
 */
export function claimTerritory(world: World, s: Settlement, budget = world.params.forageRange): void {
  const map = world.map;
  const center = map.tiles[s.tile];
  const cost = new Map<number, number>([[center.id, 0]]);
  const done = new Set<number>();
  const reached: number[] = [];
  for (;;) {
    let id = -1;
    let best = Infinity;
    for (const [k, c] of cost) if (!done.has(k) && (c < best || (c === best && k < id))) [id, best] = [k, c];
    if (id < 0) break;
    done.add(id);
    reached.push(id);
    for (const nb of neighbors(map, map.tiles[id])) {
      if (done.has(nb.id) || (nb.owner >= 0 && nb.owner !== s.id)) continue;
      const c = best + moveCost(nb, FORAGE_TECH);
      if (c <= budget && c < (cost.get(nb.id) ?? Infinity)) cost.set(nb.id, c);
    }
  }
  const keep = new Set(reached);
  for (const id of s.territory) if (map.tiles[id].plots > 0 && map.tiles[id].owner === s.id) keep.add(id);
  for (const id of s.territory) if (!keep.has(id) && map.tiles[id].owner === s.id) map.tiles[id].owner = -1;
  s.territory = [...keep];
  for (const id of s.territory) map.tiles[id].owner = s.id;
}

export function newSettlement(world: World, rng: Rng, tile: number): Settlement {
  const s: Settlement = {
    id: world.settlements.length,
    name: settlementName(rng),
    tile,
    territory: [],
    founded: world.day,
    alive: true,
    food: 0,
    tools: 0,
    clothes: 0,
    hides: 0,
    toolPrice: 6,
    clothesPrice: 10,
    toolIncome: 1,
    clothesIncome: 1,
    chiefPlots: 0,
    distance: 0,
    enforcement: 1,
    practiced: [...world.polity.institutions],
    pop: 0,
    stressMonths: 0,
    polity: world.polity.id,
    origin: world.polity.id,
    conquered: -1,
    governor: -1,
    chief: -1,
    skimAcc: 0,
    skimmed: 0,
    epidemic: 0,
    epiSeverity: 0,
    epiDeaths: 0,
    epiName: '',
    immunity: 0,
  };
  world.settlements.push(s);
  claimTerritory(world, s);
  return s;
}

/** Best unclaimed site within a ring around an origin tile. */
export function findSite(world: World, originTile: number, minD: number, maxD: number): number {
  const origin = world.map.tiles[originTile];
  const farming = has(world, 'agriculture');
  let best = -1;
  let bestScore = 0;
  for (const t of tilesWithin(world.map, origin, maxD)) {
    if (!isLand(t) || t.owner >= 0) continue;
    const d = hexDistance(origin, t);
    if (d < minD) continue;
    // a viable home range needs enough unclaimed land around it
    let free = 0;
    for (const n of tilesWithin(world.map, t, 2)) if (isLand(n) && n.owner < 0) free++;
    if (free < (farming ? 5 : 12)) continue;
    const score = siteScore(world.map, t, farming) - d * 0.5;
    if (score > bestScore || (score === bestScore && best >= 0 && t.id < best)) {
      bestScore = score;
      best = t.id;
    }
  }
  return bestScore > 40 ? best : -1;
}

/** Monthly check whether a settlement splits: too big to cohere, or hungry with better land nearby. */
/** `capacityOnly`: the extra checks in the first months only look at carrying capacity (no monthly counters). */
export function maybeFission(world: World, rng: Rng, s: Settlement, people: Person[], capacityOnly = false): Settlement | undefined {
  const P = world.params;
  const pop = people.length;
  const farmShare = people.filter((p) => p.occ === OCC.farm || p.occ === OCC.herd).length / Math.max(1, pop);
  const fissionSize = P.dunbar * (1 + 3 * farmShare) * (1 + s.enforcement * 0.5);
  const hungry = people.filter((p) => p.hunger > 0.15).length / Math.max(1, pop);
  if (!capacityOnly) s.stressMonths = hungry > 0.15 ? s.stressMonths + 1 : 0;
  const tooBig = pop > fissionSize * 1.4;
  const stressed = s.stressMonths >= 3 && pop >= 40;
  // foragers bud off when the home range is being eaten down, while free land remains
  let wild = 0;
  let cap = 0;
  for (const id of s.territory) {
    const t = world.map.tiles[id];
    wild += t.plants + t.game;
    cap += t.plantsCap + t.gameCap;
  }
  const crowded = pop >= 50 && farmShare < 0.3 && wild < cap * 0.55;
  // more mouths than the home range can feed for long: the surplus leaves, and soon
  let K = 0;
  for (const id of s.territory) K += tileCapacity(world, world.map.tiles[id]).people;
  const over = pop >= 20 && pop > K * 1.1;
  if (capacityOnly ? !over : !tooBig && !stressed && !crowded && !over) return undefined;
  if (!rng.chance(over ? 0.9 : tooBig ? 0.5 : stressed ? 0.3 : 0.08)) return undefined;
  const site = findSite(world, s.tile, 3, over ? 12 : 7);
  if (site < 0) return undefined;

  const adults = people.filter((p) => ageYears(world, p) >= 20 && p.role === 'none');
  if (!adults.length) return undefined;
  let founder = adults[0];
  for (const p of adults) if (p.ambition * (1 + p.prestige) > founder.ambition * (1 + founder.prestige)) founder = p;

  // Whole households leave together
  const leaving = new Set<number>();
  const addFamily = (p: Person) => {
    leaving.add(p.id);
    const sp = personById(world, p.spouseId);
    if (sp && sp.settlement === s.id) leaving.add(sp.id);
    for (const id of p.childIds) {
      const k = personById(world, id);
      if (k && k.settlement === s.id && ageYears(world, k) < ADULT_AGE) leaving.add(k.id);
    }
  };
  addFamily(founder);
  const share = over ? clamp((pop - K) / pop, 0.3, 0.5) : rng.range(0.3, 0.45);
  const order = rng.shuffle(people.filter((p) => ageYears(world, p) >= ADULT_AGE));
  for (const p of order) {
    if (leaving.size >= pop * share) break;
    if (p.role !== 'none' || leaving.has(p.id)) continue;
    // like-minded and kin are more likely to follow
    addFamily(p);
  }
  const ns = newSettlement(world, rng, site);
  const frac = leaving.size / pop;
  ns.food = s.food * frac;
  ns.tools = s.tools * frac;
  ns.clothes = s.clothes * frac;
  s.food -= ns.food;
  s.tools -= ns.tools;
  s.clothes -= ns.clothes;
  ns.toolPrice = s.toolPrice;
  ns.clothesPrice = s.clothesPrice;
  ns.practiced = [...s.practiced];
  for (const p of people) {
    if (!leaving.has(p.id)) continue;
    p.settlement = ns.id;
    p.plots = 0; // land stays behind
  }
  founder.notable = true;
  addBio(world, founder, `率 ${leaving.size} 人离开${s.name}，建立新聚落${ns.name}`);
  addEvent(world, 'settlement', false, `新聚落：${ns.name}`,
    `${founder.name} 带领 ${leaving.size} 人离开${s.name}（${over ? '这片土地养不活这么多人' : tooBig ? '人口过多' : stressed ? '食物短缺' : '猎物和野果日渐稀少'}），建立了${ns.name}。`,
    [founder.id], ns.id);
  return ns;
}

/** Hungry households move to a nearby settlement that is doing better. Returns true if anyone moved. */
export function migrate(world: World, rng: Rng, s: Settlement, people: Person[], groups: Person[][]): boolean {
  if (s.stressMonths < 1) return false;
  const here = world.map.tiles[s.tile];
  let dest: Settlement | undefined;
  let bestD = Infinity;
  for (const o of world.settlements) {
    if (!o.alive || o.id === s.id || o.stressMonths > 0) continue;
    const n = groups[o.id]?.length ?? 0;
    if (n === 0 || n > world.params.dunbar * 1.2) continue;
    const d = hexDistance(here, world.map.tiles[o.tile]);
    if (d <= 8 && d < bestD) {
      bestD = d;
      dest = o;
    }
  }
  if (!dest) return false;
  let moved = 0;
  const seen = new Set<number>();
  for (const p of people) {
    if (seen.has(p.id) || ageYears(world, p) < ADULT_AGE || p.role !== 'none') continue;
    if (!rng.chance(0.2)) continue;
    const family = [p, personById(world, p.spouseId), ...p.childIds.map((id) => personById(world, id))]
      .filter((k): k is Person => !!k && k.settlement === s.id && (k === p || k.id === p.spouseId || ageYears(world, k) < ADULT_AGE));
    for (const k of family) {
      seen.add(k.id);
      k.settlement = dest.id;
      k.plots = 0;
      // newcomers have to earn their standing again
      k.outsider = true;
      k.reputation = Math.min(k.reputation, world.params.outsiderRep);
      k.lowRepMonths = 0;
      k.prestige *= 0.5;
      moved++;
    }
  }
  if (moved) {
    addEvent(world, 'settlement', false, `迁徙：${s.name} → ${dest.name}`, `${s.name}缺粮，${moved} 人迁往${dest.name}。`, [], dest.id);
  }
  return moved > 0;
}

export function abandonEmpty(world: World, groups: Person[][]): void {
  for (const s of world.settlements) {
    if (!s.alive) continue;
    if ((groups[s.id]?.length ?? 0) > 0) continue;
    s.alive = false;
    for (const id of s.territory) world.map.tiles[id].owner = -1;
    s.territory = [];
    addEvent(world, 'settlement', false, `聚落消亡：${s.name}`, `${s.name}已无人居住。`, [], s.id);
  }
}
