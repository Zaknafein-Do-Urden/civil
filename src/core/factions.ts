// Factions and parties, suffrage, and social standing across generations (DESIGN.md §13).
//
// Factions are recomputed yearly from people's stances and identities: influential, ambitious adults
// act as rallying points; politically engaged adults join the one closest to them in preferences,
// clan, ethnicity, class and home. In votes members partly follow the faction line (discipline).

import { clamp } from './dmath';
import { AUTH, CHECKS, D, DIMS, SUCC, SUFFRAGE, optName } from './rules';
import { addEvent } from './events';
import { ageYears, personById, surnameOf } from './person';
import { wealth } from './economy';
import { powerWeights } from './politics';
import { ADULT_AGE, OCC } from './types';
import type { Faction, Person, World } from './types';

// --- suffrage ----------------------------------------------------------

/** Who counts in votes and in the commoners' share of power. Office holders always do. */
export function voterTest(world: World): (p: Person) => boolean {
  const pol = world.polity;
  const rule = pol.active[D.suffrage] ? pol.institutions[D.suffrage] : SUFFRAGE.all;
  switch (rule) {
    case SUFFRAGE.men:
      return (p) => p.sex === 1 || p.role !== 'none';
    case SUFFRAGE.property: {
      const med = medianAdultWealth(world);
      return (p) => p.role !== 'none' || wealth(p, world.settlements[p.settlement]) >= med;
    }
    case SUFFRAGE.ethnic: {
      const eth = rulingEthnicity(world);
      return (p) => p.role !== 'none' || p.ethnicity === eth;
    }
    case SUFFRAGE.noble:
      return (p) => p.role !== 'none' || p.noble;
    default:
      return () => true;
  }
}

export function rulingEthnicity(world: World): number {
  const l = personById(world, world.polity.leaderId);
  return l ? l.ethnicity : world.polity.id;
}

function medianAdultWealth(world: World): number {
  const ws: number[] = [];
  for (const p of world.people) if (ageYears(world, p) >= ADULT_AGE) ws.push(wealth(p, world.settlements[p.settlement]));
  if (!ws.length) return 0;
  ws.sort((a, b) => a - b);
  return ws[Math.floor(ws.length / 2)];
}

// --- standing and mobility ---------------------------------------------

function officeBonus(p: Person): number {
  if (p.role === 'leader') return 4;
  if (p.role === 'council' || p.role === 'governor') return 3;
  if (p.role === 'chief') return 2.5;
  if (p.occ === OCC.admin) return 1.5;
  if (p.occ === OCC.tinker) return 0.3;
  return 0;
}

/**
 * Yearly: office makes a family noble; adults are ranked by wealth and office among people of their own
 * age (10-year bands, so the life cycle of saving is not mistaken for class); minors record their household's rank.
 */
export function updateRanks(world: World): void {
  const bands = new Map<number, [number, Person][]>();
  for (const p of world.people) {
    if (p.role !== 'none') p.noble = true;
    const age = ageYears(world, p);
    if (age < ADULT_AGE) continue;
    const b = Math.min(5, Math.floor((age - ADULT_AGE) / 10));
    if (!bands.has(b)) bands.set(b, []);
    bands.get(b)!.push([Math.log(1 + Math.max(0, wealth(p, world.settlements[p.settlement]))) + officeBonus(p), p]);
  }
  for (const band of bands.values()) {
    band.sort((a, b) => a[0] - b[0] || a[1].id - b[1].id);
    const n = band.length;
    for (let i = 0; i < n; i++) band[i][1].rank = n > 1 ? i / (n - 1) : 0.5;
  }
  for (const p of world.people) {
    if (ageYears(world, p) >= ADULT_AGE) continue;
    const h = personById(world, p.fatherId) ?? personById(world, p.motherId) ?? personById(world, p.guardianId);
    if (h) p.originRank = h.rank;
  }
}

/** Intergenerational persistence among adults 30–55 whose childhood household rank is known. */
export function mobilityStats(world: World): { mobility: number; occInherit: number; upward: number } {
  const xs: number[] = [];
  const ys: number[] = [];
  let sameOcc = 0;
  let withOcc = 0;
  let low = 0;
  let rose = 0;
  for (const p of world.people) {
    const age = ageYears(world, p);
    if (age < 30 || age > 55) continue;
    if (p.parentOcc >= 0 && p.occ >= 0) {
      withOcc++;
      if (p.occ === p.parentOcc) sameOcc++;
    }
    if (p.originRank < 0) continue;
    xs.push(p.originRank);
    ys.push(p.rank);
    if (p.originRank < 0.4) {
      low++;
      if (p.rank > 0.6) rose++;
    }
  }
  return {
    mobility: xs.length >= 30 ? correlation(xs, ys) : -1,
    occInherit: withOcc ? sameOcc / withOcc : -1,
    upward: low >= 10 ? rose / low : -1,
  };
}

function correlation(xs: number[], ys: number[]): number {
  const n = xs.length;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i];
    my += ys[i];
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

// --- factions ----------------------------------------------------------

export const CLASS_NAMES = ['官绅', '渔猎', '农牧', '工匠', '老弱'];

/** Broad class by occupation and office. */
export function classOf(p: Person): number {
  if (p.role !== 'none' || p.occ === OCC.admin) return 0;
  if (p.occ === OCC.gather || p.occ === OCC.hunt || p.occ === OCC.fish) return 1;
  if (p.occ === OCC.farm || p.occ === OCC.herd) return 2;
  if (p.occ >= 0) return 3;
  return 4;
}

/** How inclined someone is to take sides in politics. */
export function engagement(p: Person): number {
  return 0.5 * p.ambition + 0.25 * (1 - p.conformity) + 0.3 * p.grievance + (p.role !== 'none' || p.occ === OCC.admin ? 0.3 : 0) + 0.1 * clamp(p.prestige, 0, 2);
}

/** Total-variation distance between two people's stances over the active dimensions, 0..1. */
function stanceDistance(world: World, a: number[][], b: number[][]): number {
  const act = world.polity.active;
  let s = 0;
  let n = 0;
  for (let d = 0; d < a.length; d++) {
    if (!act[d]) continue;
    const ra = a[d];
    const rb = b[d];
    let t = 0;
    for (let o = 0; o < ra.length; o++) t += Math.abs(ra[o] - rb[o]);
    s += t / 2;
    n++;
  }
  return n ? s / n : 0;
}

/** A forming faction's profile: mean stance and the shares of its members by clan, ethnicity, class and home. */
interface Profile {
  prefs: number[][];
  surname: Map<string, number>;
  eth: Map<number, number>;
  cls: Map<number, number>;
  home: Map<number, number>;
  members: Person[];
}

function profileOf(members: Person[]): Profile {
  const prefs = DIMS.map((d) => new Array<number>(d.options.length).fill(0));
  const surname = new Map<string, number>();
  const eth = new Map<number, number>();
  const cls = new Map<number, number>();
  const home = new Map<number, number>();
  const n = members.length || 1;
  const add = <K>(m: Map<K, number>, k: K) => m.set(k, (m.get(k) ?? 0) + 1 / n);
  for (const p of members) {
    for (let d = 0; d < DIMS.length; d++) for (let o = 0; o < prefs[d].length; o++) prefs[d][o] += p.prefs[d][o] / n;
    add(surname, surnameOf(p));
    add(eth, p.ethnicity);
    add(cls, classOf(p));
    add(home, p.settlement);
  }
  return { prefs, surname, eth, cls, home, members };
}

function affinity(world: World, p: Person, f: Profile): number {
  const P = world.params;
  return (
    1 - stanceDistance(world, p.prefs, f.prefs) +
    P.factionKin * (f.surname.get(surnameOf(p)) ?? 0) +
    P.factionIdentity * ((f.eth.get(p.ethnicity) ?? 0) + (f.cls.get(classOf(p)) ?? 0) + (f.home.get(p.settlement) ?? 0))
  );
}

/** Two rallying points closer than this in stance, of the same people, would split one camp. */
const MIN_SEED_DISTANCE = 0.08;

/** Yearly: rebuild the polity's factions; ids and names carry over where a faction keeps its leader or name. */
export function updateFactions(world: World): void {
  const pol = world.polity;
  const P = world.params;
  const adults = world.people.filter((p) => ageYears(world, p) >= ADULT_AGE);
  const was = new Map<number, number>();
  for (const p of world.people) {
    if (p.faction >= 0) was.set(p.id, p.faction);
    p.faction = -1;
  }
  const old = pol.factions;
  if (adults.length < 20) {
    pol.factions = [];
    return;
  }
  const engaged = adults.filter((p) => engagement(p) >= P.factionEngagement);

  // rallying points: last year's leaders first, then the most influential ambitious people
  const influence = (p: Person) => clamp(p.prestige, 0, 4) * (0.5 + p.ambition) + (p.role !== 'none' ? 1 : 0);
  const prevLeaders = old.map((f) => personById(world, f.leaderId)).filter((p): p is Person => !!p && ageYears(world, p) >= ADULT_AGE);
  const ranked = [...engaged].sort((a, b) => influence(b) - influence(a) || a.id - b.id).slice(0, 40);
  const seeds: Person[] = [];
  for (const c of [...prevLeaders, ...ranked]) {
    if (seeds.length >= P.maxFactions) break;
    if (seeds.includes(c)) continue;
    // one clan, or one people of one mind, rallies around one person
    const distinct = seeds.every((s) => {
      const gap = MIN_SEED_DISTANCE * (surnameOf(s) === surnameOf(c) ? 2 : 1);
      return s.ethnicity !== c.ethnicity || stanceDistance(world, s.prefs, c.prefs) >= gap;
    });
    if (distinct) seeds.push(c);
  }
  if (seeds.length < 2) {
    pol.factions = [];
    return;
  }

  // assign, then refine twice against the forming factions' profiles
  let profiles = seeds.map((s) => profileOf([s]));
  let groups: Person[][] = [];
  for (let iter = 0; iter < 3; iter++) {
    groups = profiles.map(() => []);
    for (const p of engaged) {
      let best = 0;
      let bs = -Infinity;
      for (let k = 0; k < profiles.length; k++) {
        const a = affinity(world, p, profiles[k]);
        if (a > bs) {
          bs = a;
          best = k;
        }
      }
      groups[best].push(p);
    }
    const min = Math.max(3, Math.round(adults.length * 0.02));
    const kept = groups.map((g, k) => [g, k] as const).filter(([g]) => g.length >= min);
    if (kept.length < 2) {
      pol.factions = [];
      return;
    }
    profiles = kept.map(([g]) => profileOf(g));
  }
  groups = profiles.map((pr) => pr.members);

  // the leader's close family follows him even if not engaged
  const memberOf = new Map<number, number>();
  groups.forEach((g, k) => g.forEach((p) => memberOf.set(p.id, k)));
  // the most prestigious member leads; a sitting faction leader keeps his place unless clearly outshone
  const prevIds = new Set(old.map((f) => f.leaderId));
  const standing = (p: Person) => p.prestige * (prevIds.has(p.id) ? 1.25 : 1);
  const leaders = groups.map((g) => g.reduce((b, p) => (standing(p) > standing(b) || (standing(p) === standing(b) && p.id < b.id) ? p : b), g[0]));
  for (const p of adults) {
    if (memberOf.has(p.id)) continue;
    const k = leaders.findIndex((l) => l.id === p.spouseId || l.id === p.fatherId || l.id === p.motherId || l.childIds.includes(p.id));
    if (k >= 0) {
      groups[k].push(p);
      memberOf.set(p.id, k);
    }
  }

  const w = powerWeights(world);
  let total = 0;
  for (const v of w.values()) total += v;
  const party = pol.institutions[D.succession] === SUCC.election || pol.institutions[D.authority] === AUTH.assembly;
  const taken = new Set<string>();
  const next: Faction[] = [];
  groups.forEach((g, k) => {
    const l = leaders[k];
    const pr = profileOf(g);
    pr.prefs = linePrefs(g, l);
    let power = 0;
    for (const p of g) power += w.get(p.id) ?? 0;
    const free = (f: Faction) => !next.some((x) => x.id === f.id);
    const prev = old.find((f) => f.leaderId === l.id && free(f)) ?? old.find((f) => free(f) && overlap(was, f.id, g) > 0.4);
    let name = prev?.name ?? '';
    let basis = prev?.basis ?? '';
    if (!prev || taken.has(name)) {
      [name, basis] = nameFaction(world, pr, l, party);
      if (taken.has(name)) name = `${l.name}${party ? '党' : '派'}`;
      if (taken.has(name)) name = `${name}${k + 1}`;
    }
    taken.add(name);
    const f: Faction = {
      id: prev ? prev.id : ++pol.factionSeq,
      name,
      basis,
      leaderId: l.id,
      founded: prev ? prev.founded : world.day,
      size: g.length,
      power: total > 0 ? power / total : 0,
      prefs: pr.prefs,
      votes: prev?.votes ?? 0,
    };
    for (const p of g) p.faction = f.id;
    next.push(f);
    if (!prev && f.power >= 0.1 && old.length) {
      addEvent(world, 'misc', false, `新派系：${name}`,
        `以${l.name}为首的${name}形成（${g.length} 人，实力 ${Math.round(f.power * 100)}%），${platformText(world, f)}。`, [l.id]);
    }
  });
  pol.factions = next.sort((a, b) => b.power - a.power || a.id - b.id);
}

/** The faction line: members' stances weighted by standing, the leader's counting most. */
function linePrefs(g: Person[], l: Person): number[][] {
  const prefs = DIMS.map((d) => new Array<number>(d.options.length).fill(0));
  let tw = 0;
  for (const p of g) {
    const w = 1 + clamp(p.prestige, 0, 3) + (p === l ? g.length * 0.1 : 0);
    tw += w;
    for (let d = 0; d < DIMS.length; d++) for (let o = 0; o < prefs[d].length; o++) prefs[d][o] += w * p.prefs[d][o];
  }
  for (const row of prefs) for (let o = 0; o < row.length; o++) row[o] /= tw || 1;
  return prefs;
}

function overlap(was: Map<number, number>, fid: number, g: Person[]): number {
  let n = 0;
  for (const p of g) if (was.get(p.id) === fid) n++;
  return g.length ? n / g.length : 0;
}

function top<K>(m: Map<K, number>): [K, number] {
  let best: [K, number] = [undefined as K, 0];
  for (const e of m) if (e[1] > best[1]) best = e;
  return best;
}

function ethnicName(world: World, id: number): string {
  if (id === world.polity.id) return world.polity.name;
  return id > 0 && world.npcs[id - 1] ? world.npcs[id - 1].polity.name : '外族';
}

/** Name a faction after what holds it together: a clan, a people, a class, a place, or its cause. */
function nameFaction(world: World, pr: Profile, l: Person, party: boolean): [string, string] {
  const suffix = party ? '党' : '派';
  const [sur, sShare] = top(pr.surname);
  if (sShare >= 0.5) return [`${sur}氏${suffix}`, '家族'];
  const [eth, eShare] = top(pr.eth);
  if (eShare >= 0.6 && eth !== rulingEthnicity(world)) return [`${ethnicName(world, eth)}人${suffix}`, '民族'];
  const [cls, cShare] = top(pr.cls);
  if (cShare >= 0.6 && cls !== 4) return [`${CLASS_NAMES[cls]}${suffix}`, '阶层'];
  const [home, hShare] = top(pr.home);
  const s = world.settlements[home];
  if (hShare >= 0.6 && s && home !== world.polity.capital) return [`${s.name}${suffix}`, '地方'];
  // its most distinctive demand against the current order
  const pol = world.polity;
  let bd = -1;
  let bo = 0;
  let gap = 0.05;
  for (let d = 0; d < DIMS.length; d++) {
    if (!pol.active[d]) continue;
    const row = pr.prefs[d];
    let o = 0;
    for (let i = 1; i < row.length; i++) if (row[i] > row[o]) o = i;
    const g = row[o] - row[pol.institutions[d]];
    if (o !== pol.institutions[d] && g > gap) {
      gap = g;
      bd = d;
      bo = o;
    }
  }
  if (bd >= 0) return [`${optName(DIMS[bd].id, bo)}${suffix}`, '主张'];
  return [`${l.name}${suffix}`, '追随者'];
}

/** What a faction wants changed, in words. */
export function platformText(world: World, f: Faction): string {
  const pol = world.polity;
  const wants: string[] = [];
  for (let d = 0; d < DIMS.length; d++) {
    if (!pol.active[d]) continue;
    const row = f.prefs[d];
    let o = 0;
    for (let i = 1; i < row.length; i++) if (row[i] > row[o]) o = i;
    if (o !== pol.institutions[d] && row[o] - row[pol.institutions[d]] > 0.03) wants.push(`${DIMS[d].name}→${optName(DIMS[d].id, o)}`);
  }
  return wants.length ? `主张${wants.join('、')}` : '维护现行制度';
}

export function factionIndex(world: World): Map<number, Faction> {
  return new Map(world.polity.factions.map((f) => [f.id, f]));
}

/** A person's stance in a vote: own preference pulled toward the faction line. */
export function voteRow(world: World, fx: Map<number, Faction>, p: Person, d: number): number[] {
  const f = p.faction >= 0 ? fx.get(p.faction) : undefined;
  if (!f || f.leaderId === p.id) return p.prefs[d];
  const k = world.params.factionDiscipline;
  return p.prefs[d].map((v, o) => (1 - k) * v + k * (f.prefs[d]?.[o] ?? v));
}

/** Share of a body (the council, or the enfranchised) in the leader's faction. */
export function leaderBacking(world: World, body: Person[]): number {
  const l = personById(world, world.polity.leaderId);
  if (!l || l.faction < 0 || !body.length) return 0;
  let n = 0;
  for (const p of body) if (p.faction === l.faction) n++;
  return n / body.length;
}

/** The body that can veto reforms and remove the leader under the current checks, or undefined. */
export function checkingBody(world: World): { name: string; members: Person[] } | undefined {
  const pol = world.polity;
  const c = pol.institutions[D.checks];
  if (!pol.active[D.checks] || c === CHECKS.none) return undefined;
  if (c === CHECKS.council) {
    return { name: '议事会', members: pol.councilIds.map((id) => personById(world, id)).filter((p): p is Person => !!p) };
  }
  const ok = voterTest(world);
  return { name: '大会', members: world.people.filter((p) => p.id !== pol.leaderId && ageYears(world, p) >= ADULT_AGE && ok(p)) };
}

// --- saves -------------------------------------------------------------

/** Fill fields and dimensions added with factions into an older save. */
export function migrateFactions(w: World): void {
  for (const sc of [w, ...w.npcs]) {
    const pol = sc.polity;
    pol.factions ??= [];
    pol.factionSeq ??= 0;
    for (let d = pol.institutions.length; d < DIMS.length; d++) {
      pol.institutions.push(0);
      pol.active.push(DIMS[d].id === 'checks');
    }
    pol.vetoed ??= DIMS.map(() => -1);
  }
  for (const s of w.settlements) for (let d = s.practiced.length; d < DIMS.length; d++) s.practiced.push(0);
  for (const p of w.people) {
    for (let d = p.prefs.length; d < DIMS.length; d++) {
      const n = DIMS[d].options.length;
      p.prefs.push(new Array<number>(n).fill(1 / n));
    }
    p.faction ??= -1;
    p.noble ??= p.role !== 'none';
    p.rank ??= 0.5;
    p.originRank ??= -1;
  }
}
