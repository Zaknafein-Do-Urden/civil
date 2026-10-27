// World creation, the day/month/year loop, the command queue, state hash and serialization (DESIGN.md §8.2).

import { DEFAULT_PARAMS } from './params';
import type { Params } from './params';
import { ALLOC, D, UNSPECIFIED } from './rules';
import type { CultureSetting } from './rules';
import { Rng, seedRng } from './rng';
import { generateMap, hexDistance, isLand, siteScore } from './map';
import { ERAS, TECHS, availableTechs, computeEra, monthlyResearch } from './tech';
import { addBio, ageYears, createFounder, personById, surnameOf } from './person';
import { addEvent } from './events';
import { charity, chooseJobs, dailySettlement, market, patronage, regenTiles } from './economy';
import { exclusion, migrateLabor, updateLabor } from './labor';
import { abandonEmpty, assignGuardian, claimTerritory, dailyDemography, marriages, rangeBudget, maybeFission, migrate, newSettlement } from './demography';
import {
  appointAdmins, chooseCouncil, chooseLeader, corruption, ensureLeader, institutionalChange, maybeElection, payAdmins,
  plannerMath, startMovement, unrest, updateActive, updateEnforcement, updateLegitimacy, updateMood, updatePracticed,
  updatePrestige,
} from './politics';
import { cultureMonthly } from './culture';
import { migrateFactions, updateFactions, updateRanks } from './factions';
import { diseaseMonthly } from './disease';
import { updateLocalRulers } from './control';
import { updateDemand, yearStats } from './stats';
import { emptyTileHistory, recordTileHistory } from './tiles';
import { ADULT_AGE, DAYS_PER_MONTH, DAYS_PER_YEAR, OCC } from './types';
import type { Command, Person, World } from './types';
import { PLAYER, emptyAcc, emptyYearAcc, forEachPolity, inPolity, newScope, npcCulture, npcSite, polityHue, polityName, takenNames } from './nations';
import { diplomacyYearly, initRelations, pushWarMood, warDemand, warMonthly } from './war';
import { crossBorderMonthly } from './crossborder';

export interface WorldConfig {
  seed: string;
  culture?: CultureSetting;
  startTile?: number;
  population?: number;
  /** Number of NPC tribes placed elsewhere on the map (DESIGN.md §12.3). */
  npcCount?: number;
  /** Starting population of each NPC tribe. */
  npcPopulation?: number;
  params?: Partial<Params>;
}

/** Conservative defaults: every NPC is fully simulated, so total population roughly doubles. */
export const DEFAULT_NPC_COUNT = 3;
export const DEFAULT_NPC_POPULATION = 300;

export function bestStartTile(world: World): number {
  let best = -1;
  let bs = -Infinity;
  for (const t of world.map.tiles) {
    if (!isLand(t)) continue;
    const s = siteScore(world.map, t, false);
    if (s > bs) {
      bs = s;
      best = t.id;
    }
  }
  return best;
}

export function createWorld(cfg: WorldConfig): World {
  const rng = new Rng(seedRng(cfg.seed));
  const culture = cfg.culture ?? UNSPECIFIED;
  const map = generateMap(cfg.seed);
  const world: World = {
    version: 1,
    seed: cfg.seed,
    day: 0,
    rng: rng.state,
    params: { ...DEFAULT_PARAMS, ...cfg.params },
    map,
    people: [],
    nextId: 1,
    settlements: [],
    ...newScope(rng, PLAYER, culture),
    events: [],
    eventSeq: 0,
    pending: [],
    commandLog: [],
    notables: [],
    tileHistory: emptyTileHistory(),
    npcs: [],
    relations: [],
    wars: [],
    warSeq: 0,
  };

  const pop = cfg.population ?? 1000;
  const start = cfg.startTile !== undefined && isLand(map.tiles[cfg.startTile]) ? cfg.startTile : bestStartTile(world);
  inPolity(world, PLAYER, (v) => foundTribe(v, rng, start, pop));

  // NPC tribes elsewhere on the map, same rules, their own cultures (DESIGN.md §12.3)
  const home = map.tiles[start];
  const npcPop = cfg.npcPopulation ?? DEFAULT_NPC_POPULATION;
  for (let i = 0; i < (cfg.npcCount ?? DEFAULT_NPC_COUNT); i++) {
    let site = npcSite(world, 9);
    if (site < 0) site = npcSite(world, 6);
    if (site < 0) break;
    const closeness = 1 - (hexDistance(home, map.tiles[site]) - 9) / 30;
    const id = world.npcs.length + 1;
    world.npcs.push(newScope(rng, id, npcCulture(rng, culture, closeness)));
    inPolity(world, id, (v) => foundTribe(v, rng, site, npcPop));
  }
  initRelations(world);
  world.rng = rng.state;
  return world;
}

/** A tribe starts as a single camp on the start tile; runs on the polity's view. */
function foundTribe(world: World, rng: Rng, start: number, pop: number): void {
  // The whole tribe starts as one camp; it splits on its own once food runs short (maybeFission)
  const first = newSettlement(world, rng, start);
  const bands = [first];
  if (pop < SMALL_GROUP) {
    foundHouseholds(world, rng, first.id, pop);
  } else {
    for (let i = 0; i < pop; i++) world.people.push(createFounder(world, rng, first.id));
    formFamilies(world, rng);
  }
  first.food = 90 * pop * world.params.foodNeedAdult; // three months of stores
  world.polity.capital = first.id;
  if (!world.polity.name) world.polity.name = world.polity.id === PLAYER ? `${first.name}部落` : polityName(rng, takenNames(world));

  addEvent(world, 'misc', false, '部落诞生',
    `${pop} 人在${first.name}一带生活。`);
  const groups = groupBySettlement(world);
  chooseLeader(world, rng, '部落推举首领');
  chooseCouncil(world);
  appointAdmins(world);
  updateEnforcement(world);
  updatePracticed(world, groups);
  updateDemand(world, groups);
  const pm = plannerMath(world);
  for (const s of bands) {
    chooseJobs(world, rng, s, groups[s.id], pm, 0);
  }
}

/** Below this size founders are drawn as households, so a handful of people is not all men or all elders. */
const SMALL_GROUP = 50;

/** Couples with children until the count is reached; a leftover single person joins as an adult. */
function foundHouseholds(world: World, rng: Rng, settlement: number, pop: number): void {
  let n = 0;
  while (n < pop) {
    if (pop - n === 1) {
      world.people.push(createFounder(world, rng, settlement, { sex: rng.chance(0.5) ? 1 : 0, age: rng.range(18, 35) }));
      break;
    }
    const wAge = rng.range(18, 34);
    const man = createFounder(world, rng, settlement, { sex: 1, age: wAge + rng.range(0, 8) });
    const woman = createFounder(world, rng, settlement, { sex: 0, age: wAge });
    man.spouseId = woman.id;
    woman.spouseId = man.id;
    world.people.push(man, woman);
    n += 2;
    const kids = Math.min(pop - n, rng.int(4));
    for (let i = 0; i < kids; i++) {
      const k = createFounder(world, rng, settlement, {
        sex: rng.chance(0.51) ? 1 : 0, age: rng.range(0, Math.min(16, wAge - 17)), surname: surnameOf(man),
      });
      k.motherId = woman.id;
      k.fatherId = man.id;
      woman.childIds.push(k.id);
      man.childIds.push(k.id);
      world.people.push(k);
    }
    n += kids;
  }
}

function formFamilies(world: World, rng: Rng): void {
  for (const s of world.settlements) {
    if (!s.alive) continue;
    const people = world.people.filter((p) => p.settlement === s.id);
    marriagesAll(world, rng, people);
    const mothers = people.filter((p) => p.sex === 0 && p.spouseId >= 0);
    for (const k of people) {
      const age = ageYears(world, k);
      if (age >= ADULT_AGE) continue;
      const cands = mothers.filter((m) => {
        const gap = ageYears(world, m) - age;
        return gap >= 17 && gap <= 40;
      });
      if (!cands.length) {
        assignGuardian(world, k);
        continue;
      }
      const m = rng.pick(cands);
      const f = personById(world, m.spouseId);
      k.motherId = m.id;
      m.childIds.push(k.id);
      if (f) {
        k.fatherId = f.id;
        f.childIds.push(k.id);
        k.name = f.name[0] + k.name.slice(1);
      }
    }
  }
}

function marriagesAll(world: World, rng: Rng, people: Person[]): void {
  const women = rng.shuffle(people.filter((p) => p.sex === 0 && ageYears(world, p) >= ADULT_AGE));
  const men = rng.shuffle(people.filter((p) => p.sex === 1 && ageYears(world, p) >= ADULT_AGE));
  for (let i = 0; i < Math.min(women.length, men.length); i++) {
    if (!rng.chance(0.8)) continue;
    women[i].spouseId = men[i].id;
    men[i].spouseId = women[i].id;
  }
}

export function groupBySettlement(world: World): Person[][] {
  const groups: Person[][] = world.settlements.map(() => []);
  for (const p of world.people) groups[p.settlement].push(p);
  for (const s of world.settlements) s.pop = groups[s.id].length;
  return groups;
}

/** Queue a player command; it takes effect at the start of the next simulated day. */
export function issue(world: World, cmd: Command): void {
  world.pending.push({ ...cmd, day: world.day });
}

function applyCommands(world: World, rng: Rng): void {
  const due = world.pending.filter((c) => c.day <= world.day);
  if (!due.length) return;
  world.pending = world.pending.filter((c) => c.day > world.day);
  for (const c of due) {
    // player commands only reach the player's own people
    if (c.type === 'movement') inPolity(world, PLAYER, (v) => startMovement(v, rng, c.dim, c.opt, c.strength));
    else if (c.type === 'warMood') pushWarMood(world, PLAYER, c.value);
    else if (c.type === 'params') world.params = { ...world.params, ...c.params };
    world.commandLog.push(c);
  }
}

/** Advance one day. */
export function step(world: World): void {
  const rng = new Rng(world.rng);
  applyCommands(world, rng);
  forEachPolity(world, (v) => daily(v, rng));
  regenTiles(world);

  world.day++;
  if (world.day < EARLY_DISPERSAL_DAYS && world.day % 10 === 0 && world.day % DAYS_PER_MONTH !== 0) {
    forEachPolity(world, (v) => earlyDispersal(v, rng));
  }
  if (world.day % DAYS_PER_MONTH === 0) {
    forEachPolity(world, (v) => monthly(v, rng, groupBySettlement(v)));
    crossBorderMonthly(world, rng);
    warMonthly(world, rng);
    diseaseMonthly(world, rng);
  }
  if (world.day % DAYS_PER_YEAR === 0) {
    forEachPolity(world, (v) => yearly(v, rng));
    diplomacyYearly(world, rng);
    recordTileHistory(world); // the map is shared by all polities
    if (!world.people.length) addEvent(world, 'misc', true, '文明消亡', '最后一个人也死去了。');
  }
  world.rng = rng.state;
}

/** One polity's daily production, consumption, births and deaths; runs on its view. */
function daily(world: World, rng: Rng): void {
  const groups = groupBySettlement(world);
  for (const s of world.settlements) {
    if (s.alive && groups[s.id].length) dailySettlement(world, rng, s, groups[s.id]);
  }
  const leaderBefore = personById(world, world.polity.leaderId);
  const dead = dailyDemography(world, rng, groups);
  if (!world.people.length) return;
  if (leaderBefore && dead.some((d) => d.person.id === leaderBefore.id)) ensureLeader(world, rng, leaderBefore);
  else if (!personById(world, world.polity.leaderId)) ensureLeader(world, rng);
}

/** The first three months: the founding camp disperses every 10 days instead of monthly. */
const EARLY_DISPERSAL_DAYS = 90;

function earlyDispersal(world: World, rng: Rng): void {
  const groups = groupBySettlement(world);
  const n = world.settlements.length;
  for (let i = 0; i < n; i++) {
    const s = world.settlements[i];
    if (!s.alive || !groups[s.id]?.length) continue;
    if (maybeFission(world, rng, s, groups[s.id], true)) {
      for (let j = 0; j < world.settlements.length; j++) groups[j] = [];
      for (const p of world.people) groups[p.settlement].push(p);
    }
  }
}

function monthly(world: World, rng: Rng, groups: Person[][]): void {
  world.lastMonth = world.monthAcc;
  world.monthAcc = emptyAcc();
  updateDemand(world, groups);
  world.demand.war = warDemand(world);

  const available = availableTechs(world);
  monthlyResearch(world, available);
  breakthroughs(world, rng, available);

  updatePrestige(world, groups);
  updateMood(world, groups);
  updateLegitimacy(world);
  corruption(world);
  payAdmins(world, rng);
  appointAdmins(world);

  const pm = plannerMath(world);
  const n = world.settlements.length;
  for (let i = 0; i < n; i++) {
    const s = world.settlements[i];
    const people = groups[s.id];
    if (!s.alive || !people?.length) continue;
    for (const p of people) {
      p.output = p.outputAcc;
      p.outputAcc = 0;
      p.avgHours = p.hoursAcc / DAYS_PER_MONTH;
      p.hoursAcc = 0;
    }
    let funds = 0;
    if (s.practiced[D.allocation] === ALLOC.exchange) {
      market(world, rng, s, people);
      funds = patronage(world, s, people);
      charity(world, people);
    }
    updateLabor(world, rng, s, people);
    chooseJobs(world, rng, s, people, pm, funds);
    marriages(world, rng, people);
    const ns = maybeFission(world, rng, s, people);
    if (ns || migrate(world, rng, s, people, groups) || exclusion(world, rng, s, people, groups)) {
      for (let j = 0; j < world.settlements.length; j++) groups[j] = [];
      for (const p of world.people) groups[p.settlement].push(p);
    }
  }
  cultureMonthly(world, groups);
  abandonEmpty(world, groups);
}

function breakthroughs(world: World, rng: Rng, available: number[]): void {
  const t = world.tech;
  for (const i of available) {
    if (t.progress[i] < TECHS[i].cost * t.threshold[i]) continue;
    t.known[i] = true;
    t.day[i] = world.day;
    const def = TECHS[i];
    const cands = world.people.filter((p) => p.occ === OCC.tinker || def.occs.includes(p.occ));
    let inventor: Person | undefined;
    if (cands.length) {
      const w = cands.map((p) => (0.5 + p.skills[Math.max(0, p.occ)]) * (p.math / 50) * (p.math / 50) * (p.occ === OCC.tinker ? 3 : 1));
      inventor = cands[rng.weighted(w)];
    }
    if (inventor) {
      t.inventor[i] = inventor.id;
      inventor.notable = true;
      addBio(world, inventor, `发明了「${def.name}」`);
    }
    addEvent(world, 'tech', false, `新科技：${def.name}`,
      `${inventor ? inventor.name + '（' + (inventor.occ === OCC.tinker ? '研究者' : '从业者') + '）' : '有人'}发明了「${def.name}」：${def.desc}。`,
      inventor ? [inventor.id] : []);
  }
  const era = computeEra(world);
  if (era !== world.era) {
    world.era = era;
    addEvent(world, 'era', true, `进入${ERAS[era]}`, `社会进入了${ERAS[era]}。`);
  }
}

function yearly(world: World, rng: Rng): void {
  const groups = groupBySettlement(world);
  for (const s of world.settlements) if (s.alive) claimTerritory(world, s, rangeBudget(world, groups[s.id]));
  updateActive(world);
  updateEnforcement(world);
  updatePracticed(world, groups);
  updateLocalRulers(world, groups);
  updateRanks(world);
  updateFactions(world);
  institutionalChange(world);
  unrest(world, rng);
  maybeElection(world, rng);
  chooseCouncil(world);
  const st = yearStats(world);
  world.stats.push(st);
  if (st.pop > 0 && st.starved / st.pop > 0.05) {
    addEvent(world, 'famine', true, '大饥荒', `过去一年有 ${st.starved} 人死于饥寒，占人口 ${((st.starved / st.pop) * 100).toFixed(1)}%。`);
  }
  world.yearAcc = emptyYearAcc();
}

export function runDays(world: World, days: number): void {
  for (let i = 0; i < days && world.people.length; i++) step(world);
}

// --- hashing and persistence -------------------------------------------

export function serialize(world: World): string {
  return JSON.stringify(world);
}

export function deserialize(json: string): World {
  const w = JSON.parse(json) as World;
  // saves from before multiple polities
  if (!w.npcs) {
    Object.assign(w.polity, { id: PLAYER, name: '部落', hue: polityHue(PLAYER), alive: true, warMood: 0 });
    for (const s of w.settlements) Object.assign(s, { polity: PLAYER, origin: PLAYER, conquered: -1 });
    Object.assign(w, { npcs: [], relations: [], wars: [], warSeq: 0 });
  }
  // techs added after the save was made
  for (const sc of [w, ...w.npcs]) {
    const t = sc.tech;
    for (let i = t.known.length; i < TECHS.length; i++) {
      t.known.push(false);
      t.progress.push(0);
      t.threshold.push(1);
      t.day.push(-1);
      t.inventor.push(-1);
    }
  }
  migrateLabor(w);
  migrateFactions(w); // saves from before factions, suffrage and checks
  // saves from before ethnicity and epidemics
  for (const s of w.settlements) {
    s.governor ??= -1;
    if (s.chief === undefined) Object.assign(s, { chief: -1, skimAcc: 0, skimmed: 0 });
    if (s.epidemic === undefined) Object.assign(s, { epidemic: 0, epiSeverity: 0, epiDeaths: 0, epiName: '', immunity: 0 });
    s.importStone ??= 0;
  }
  // saves from before cross-border trade and marriage
  for (const sc of [w, ...w.npcs]) {
    sc.polity.imports ??= { copper: 0, tin: 0 };
    sc.polity.metals ??= { copper: 1, tin: 1 };
  }
  for (const r of w.relations) {
    if (r.trade === undefined) Object.assign(r, { trade: 0, tradeAcc: 0, marriages: 0, marriagesAcc: 0, migrants: 0, migrantsAcc: 0 });
  }
  for (const p of w.people) p.ethnicity ??= w.settlements[p.settlement].origin;
  w.tileHistory ??= emptyTileHistory(); // saves from before tile history
  return w;
}

/** FNV-1a over the serialized state, for desync detection and regression tests. */
export function stateHash(world: World): string {
  const s = serialize(world);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export { DAYS_PER_YEAR };
