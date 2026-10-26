// World creation, the day/month/year loop, the command queue, state hash and serialization (DESIGN.md §8.2).

import { DEFAULT_PARAMS } from './params';
import type { Params } from './params';
import { ALLOC, D, DIMS, UNSPECIFIED, optIndex } from './rules';
import type { CultureSetting } from './rules';
import { Rng, seedRng } from './rng';
import { generateMap, isLand, siteScore } from './map';
import { ERAS, TECHS, availableTechs, computeEra, initTech, monthlyResearch } from './tech';
import { addBio, ageYears, createFounder, personById } from './person';
import { addEvent } from './events';
import { charity, chooseJobs, dailySettlement, market, patronage, regenTiles, updateEffort } from './economy';
import { abandonEmpty, assignGuardian, dailyDemography, findSite, marriages, maybeFission, migrate, newSettlement } from './demography';
import {
  appointAdmins, chooseCouncil, chooseLeader, corruption, ensureLeader, institutionalChange, maybeElection, payAdmins,
  plannerMath, startMovement, unrest, updateActive, updateEnforcement, updateLegitimacy, updateMood, updatePracticed,
  updatePrestige,
} from './politics';
import { cultureMonthly } from './culture';
import { updateDemand, yearStats } from './stats';
import { ADULT_AGE, DAYS_PER_MONTH, DAYS_PER_YEAR, NOCC, OCC } from './types';
import type { Command, Person, World } from './types';

export interface WorldConfig {
  seed: string;
  culture?: CultureSetting;
  startTile?: number;
  population?: number;
  params?: Partial<Params>;
}

/** Band-society customs used where the player left a dimension unspecified. */
const BAND_DEFAULT: Record<string, string> = {
  allocation: 'sharing', land: 'common', occupation: 'free', distribution: 'need', tax: 'none',
  authority: 'assembly', succession: 'prestige', inheritance: 'equal', speech: 'free',
};

const emptyAcc = () => ({ foodProduced: 0, foodDecayed: 0, coldSum: 0, hungerDays: 0, personDays: 0 });

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
  const institutions = DIMS.map((d) => optIndex(d.id, culture[d.id] ?? BAND_DEFAULT[d.id]));
  const world: World = {
    version: 1,
    seed: cfg.seed,
    day: 0,
    rng: rng.state,
    params: { ...DEFAULT_PARAMS, ...cfg.params },
    culture,
    map,
    people: [],
    nextId: 1,
    settlements: [],
    polity: {
      leaderId: -1,
      leaderSince: 0,
      councilIds: [],
      capital: 0,
      treasury: { food: 0, tools: 0, clothes: 0 },
      legitimacy: 0.6,
      institutions,
      active: DIMS.map((d) => d.id !== 'land'),
      dynasty: 1,
    },
    tech: initTech(rng),
    demand: {},
    researchAcc: new Array(NOCC).fill(0),
    monthAcc: emptyAcc(),
    lastMonth: emptyAcc(),
    era: 0,
    stats: [],
    yearAcc: { births: 0, deaths: 0, starved: 0 },
    events: [],
    eventSeq: 0,
    pending: [],
    commandLog: [],
    notables: [],
  };

  // Bands of a tribe settle around the start tile
  const pop = cfg.population ?? 1000;
  const start = cfg.startTile !== undefined && isLand(map.tiles[cfg.startTile]) ? cfg.startTile : bestStartTile(world);
  const nBands = Math.max(1, Math.round(pop / 70));
  const first = newSettlement(world, rng, start);
  for (let i = 1; i < nBands; i++) {
    let site = -1;
    for (const s of world.settlements) {
      site = findSite(world, s.tile, 3, 6);
      if (site >= 0) break;
    }
    if (site < 0) break;
    newSettlement(world, rng, site);
  }
  const bands = world.settlements;
  for (let i = 0; i < pop; i++) {
    const s = bands[i % bands.length];
    world.people.push(createFounder(world, rng, s.id));
  }
  formFamilies(world, rng);
  for (const s of bands) s.food = 30 * world.people.filter((p) => p.settlement === s.id).length;
  world.polity.capital = first.id;

  addEvent(world, 'misc', false, '部落诞生',
    `${pop} 人分成 ${bands.length} 个群落，在${first.name}一带生活。`);
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
    updateEffort(world, s, groups[s.id], 0);
  }
  world.rng = rng.state;
  return world;
}

function formFamilies(world: World, rng: Rng): void {
  for (const s of world.settlements) {
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
    if (c.type === 'movement') startMovement(world, rng, c.dim, c.opt, c.strength);
    else if (c.type === 'params') world.params = { ...world.params, ...c.params };
    world.commandLog.push(c);
  }
}

/** Advance one day. */
export function step(world: World): void {
  const rng = new Rng(world.rng);
  applyCommands(world, rng);
  const groups = groupBySettlement(world);

  for (const s of world.settlements) {
    if (s.alive && groups[s.id].length) dailySettlement(world, rng, s, groups[s.id]);
  }
  const leaderBefore = personById(world, world.polity.leaderId);
  const dead = dailyDemography(world, rng, groups);
  if (leaderBefore && dead.some((d) => d.person.id === leaderBefore.id)) ensureLeader(world, rng, leaderBefore);
  else if (!personById(world, world.polity.leaderId)) ensureLeader(world, rng);
  regenTiles(world);

  world.day++;
  if (world.day % DAYS_PER_MONTH === 0) monthly(world, rng, groups);
  if (world.day % DAYS_PER_YEAR === 0) yearly(world, rng);
  world.rng = rng.state;
}

function monthly(world: World, rng: Rng, groups: Person[][]): void {
  world.lastMonth = world.monthAcc;
  world.monthAcc = emptyAcc();
  updateDemand(world, groups);

  const available = availableTechs(world);
  monthlyResearch(world, available);
  breakthroughs(world, rng, available);

  updatePrestige(world, groups);
  updateMood(world, groups);
  updateLegitimacy(world);
  corruption(world);
  payAdmins(world, rng);
  appointAdmins(world);

  const admins = world.people.filter((p) => p.occ === OCC.admin).length;
  const pm = plannerMath(world);
  const n = world.settlements.length;
  for (let i = 0; i < n; i++) {
    const s = world.settlements[i];
    const people = groups[s.id];
    if (!s.alive || !people?.length) continue;
    for (const p of people) {
      p.output = p.outputAcc;
      p.outputAcc = 0;
    }
    let funds = 0;
    if (s.practiced[D.allocation] === ALLOC.exchange) {
      market(world, rng, s, people);
      funds = patronage(world, s, people);
      charity(world, people);
    }
    updateEffort(world, s, people, (admins * people.length) / Math.max(1, world.people.length));
    chooseJobs(world, rng, s, people, pm, funds);
    marriages(world, rng, people);
    const ns = maybeFission(world, rng, s, people);
    if (ns || migrate(world, rng, s, people, groups)) {
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
  updateActive(world);
  updateEnforcement(world);
  updatePracticed(world, groups);
  institutionalChange(world);
  unrest(world, rng);
  maybeElection(world, rng);
  chooseCouncil(world);
  const st = yearStats(world);
  world.stats.push(st);
  if (st.pop > 0 && st.starved / st.pop > 0.05) {
    addEvent(world, 'famine', true, '大饥荒', `过去一年有 ${st.starved} 人死于饥寒，占人口 ${((st.starved / st.pop) * 100).toFixed(1)}%。`);
  }
  if (st.pop === 0) addEvent(world, 'misc', true, '文明消亡', '最后一个人也死去了。');
  world.yearAcc = { births: 0, deaths: 0, starved: 0 };
}

export function runDays(world: World, days: number): void {
  for (let i = 0; i < days && world.people.length; i++) step(world);
}

// --- hashing and persistence -------------------------------------------

export function serialize(world: World): string {
  return JSON.stringify(world);
}

export function deserialize(json: string): World {
  return JSON.parse(json) as World;
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
