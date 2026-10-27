// Contact, relations, war and peace between polities (DESIGN.md §12.4–12.6).
// Motives come from individuals (hunger, land, ambition, revenge); decisions go through each
// polity's own institutions (power-weighted, like reforms); reach is limited by distance.

import { clamp, exp, ln, sigmoid } from './dmath';
import { AUTH, D, DIMS } from './rules';
import { addBio, ageYears, personById } from './person';
import { addEvent } from './events';
import { hexDistance, neighbors } from './map';
import { TECH_INDEX } from './tech';
import { killPeople } from './demography';
import { levyObedience } from './control';
import { appointAdmins, chooseCouncil, chooseLeader, powerWeights, updateEnforcement } from './politics';
import { PLAYER, allPolities, inPolity, newScope, polityName, polityOf, polityView, scopeOf, takenNames } from './nations';
import { UNSPECIFIED } from './rules';
import type { Rng } from './rng';
import { ADULT_AGE, DAYS_PER_YEAR, OCC } from './types';
import type { Person, Polity, Relation, Settlement, Tile, War, World } from './types';

const TRUCE_YEARS = 10;
const ASSIMILATE_YEARS = 50;
const MAX_ENDED_WARS = 60;

// --- per-polity snapshot -------------------------------------------------

interface Realm {
  id: number;
  pol: Polity;
  people: Person[];
  adults: Person[];
  settlements: Settlement[];
  /** Men able to fight, by settlement id. */
  men: Map<number, Person[]>;
  nMen: number;
  hunger: number;
  pressure: number;
  grievance: number;
}

function knows(world: World, pid: number, tech: string): boolean {
  return scopeOf(world, pid).tech.known[TECH_INDEX[tech]];
}

function fighter(world: World, p: Person): number {
  if (p.sex !== 1) return 0;
  const age = ageYears(world, p);
  if (age < ADULT_AGE || age > 50 || p.health < 0.3) return 0;
  // hunters already know their weapons
  return (p.physical / 50) * p.health * (p.occ === OCC.hunt ? 1.3 : 1);
}

function realms(world: World): (Realm | undefined)[] {
  const out: (Realm | undefined)[] = [];
  for (const pol of allPolities(world)) {
    if (!pol.alive) {
      out.push(undefined);
      continue;
    }
    const sc = scopeOf(world, pol.id);
    const lm = sc.lastMonth;
    out.push({
      id: pol.id, pol, people: [], adults: [], settlements: [], men: new Map(), nMen: 0,
      hunger: lm.personDays ? lm.hungerDays / lm.personDays : 0, pressure: 0, grievance: 0,
    });
  }
  for (const s of world.settlements) if (s.alive) out[s.polity]?.settlements.push(s);
  for (const p of world.people) {
    const r = out[world.settlements[p.settlement].polity];
    if (!r) continue;
    r.people.push(p);
    if (ageYears(world, p) < ADULT_AGE) continue;
    r.adults.push(p);
    r.grievance += p.grievance;
    // conquered people do not fight for their new masters until assimilated
    const home = world.settlements[p.settlement];
    if (home.origin === home.polity && fighter(world, p) > 0) {
      let m = r.men.get(p.settlement);
      if (!m) r.men.set(p.settlement, (m = []));
      m.push(p);
      r.nMen++;
    }
  }
  for (let i = 0; i < out.length; i++) {
    const r = out[i];
    if (!r) continue;
    if (!r.people.length) {
      out[i] = undefined;
      continue;
    }
    r.grievance /= Math.max(1, r.adults.length);
    // land pressure: home ranges eaten down, or settlements going hungry
    let pw = 0;
    let pop = 0;
    for (const s of r.settlements) {
      let wild = 0;
      let cap = 0;
      for (const id of s.territory) {
        const t = world.map.tiles[id];
        wild += t.plants + t.game;
        cap += t.plantsCap + t.gameCap;
      }
      const eaten = clamp((0.75 - wild / Math.max(1, cap)) / 0.5, 0, 1);
      pw += s.pop * Math.max(eaten, s.stressMonths > 0 ? 1 : 0);
      pop += s.pop;
    }
    r.pressure = pop ? pw / pop : 0;
  }
  return out;
}

function weapons(world: World, pid: number): number {
  return 1 + (knows(world, pid, 'spear_thrower') ? 0.15 : 0) + (knows(world, pid, 'bow') ? 0.25 : 0) +
    (knows(world, pid, 'copper') ? 0.15 : 0) + (knows(world, pid, 'bronze') ? 0.2 : 0) + (knows(world, pid, 'bronze_weapons') ? 0.4 : 0);
}

function leadership(world: World, r: Realm): number {
  const l = personById(world, r.pol.leaderId);
  return l ? 0.7 + ((l.social + l.physical) / 200) * 0.6 : 0.7;
}

function morale(r: Realm): number {
  return clamp(0.5 + 0.6 * r.pol.legitimacy - 0.5 * r.grievance + 0.3 * r.pol.warMood, 0.2, 1.5);
}

/** Whole fighting strength, ignoring distance. */
function strength(world: World, r: Realm): number {
  let f = 0;
  for (const men of r.men.values()) for (const p of men) f += fighter(world, p);
  return f * weapons(world, r.id) * leadership(world, r) * morale(r);
}

interface Force {
  value: number;
  /** Who takes part, with the chance each is in the fight. */
  men: Person[];
}

/** Men raised near a target: only settlements within range send anyone, more where the state reaches. */
function raise(world: World, rng: Rng, r: Realm, target: Tile, range: number, levy: number, home = -1): Force {
  const men: Person[] = [];
  let v = 0;
  for (const s of r.settlements) {
    const d = hexDistance(world.map.tiles[s.tile], target);
    if (d > range) continue;
    const share = s.id === home ? 1 : levy * levyObedience(world, s);
    for (const p of r.men.get(s.id) ?? []) {
      if (!rng.chance(share)) continue;
      men.push(p);
      v += fighter(world, p);
    }
  }
  return { value: v * weapons(world, r.id) * leadership(world, r) * morale(r), men };
}

// --- relations -----------------------------------------------------------

export function relation(world: World, x: number, y: number): Relation | undefined {
  const a = Math.min(x, y);
  const b = Math.max(x, y);
  return world.relations.find((r) => r.a === a && r.b === b);
}

function grudge(rel: Relation, from: number): number {
  return from === rel.a ? rel.grudgeA : rel.grudgeB;
}

function addGrudge(rel: Relation, from: number, v: number): void {
  if (from === rel.a) rel.grudgeA = clamp(rel.grudgeA + v, 0, 2);
  else rel.grudgeB = clamp(rel.grudgeB + v, 0, 2);
}

/** Make sure every pair of polities has a relation record. */
export function initRelations(world: World): void {
  const n = 1 + world.npcs.length;
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      if (relation(world, a, b)) continue;
      world.relations.push({
        a, b, status: 'none', since: world.day, opinion: 0, ties: 0, friction: 0, grudgeA: 0, grudgeB: 0, tributary: -1, truceUntil: 0,
        trade: 0, tradeAcc: 0, marriages: 0, marriagesAcc: 0, migrants: 0, migrantsAcc: 0,
      });
    }
  }
}

export const STATUS_NAMES: Record<Relation['status'], string> = {
  none: '未接触', contact: '接触', peace: '和平', alliance: '同盟', tribute: '朝贡', war: '战争',
};

export const GOAL_NAMES: Record<War['goal'], string> = {
  raid: '抢粮', land: '扩张', revenge: '复仇', independence: '摆脱朝贡', ally: '援助盟友',
};

function involvesPlayer(...ids: number[]): boolean {
  return ids.includes(PLAYER);
}

function howDecided(pol: Polity): string {
  const a = pol.institutions[D.authority];
  return a === AUTH.chief ? '首领下令' : a === AUTH.council ? '议事会决定' : '大会表决';
}

/** Mean preference rows of a polity's adults, for cultural similarity. */
function meanPrefs(r: Realm): number[][] {
  const m = DIMS.map((d) => new Array<number>(d.options.length).fill(0));
  for (const p of r.adults) for (let d = 0; d < DIMS.length; d++) for (let o = 0; o < m[d].length; o++) m[d][o] += p.prefs[d][o];
  const n = Math.max(1, r.adults.length);
  for (const row of m) for (let o = 0; o < row.length; o++) row[o] /= n;
  return m;
}

/** 1 = identical customs, 0 = opposite. */
function similarity(a: number[][], b: number[][]): number {
  let dist = 0;
  for (let d = 0; d < a.length; d++) for (let o = 0; o < a[d].length; o++) dist += Math.abs(a[d][o] - b[d][o]);
  return 1 - dist / (2 * a.length);
}

// --- decisions -----------------------------------------------------------

/** Power-weighted mean of a per-person support score (0..1), decided through the polity's own institutions. */
function decide(world: World, r: Realm, score: (p: Person) => number): number {
  const w = powerWeights(polityView(world, r.id, r.people));
  let s = 0;
  let t = 0;
  for (const p of r.adults) {
    const v = w.get(p.id);
    if (!v) continue;
    s += v * score(p);
    t += v;
  }
  return t ? s / t : 0;
}

interface Motives {
  need: number;
  land: number;
  revenge: number;
  freedom: number;
  total: number;
}

/** Polity-level reasons for X to fight Y (shared by everyone in X). */
function motives(world: World, x: Realm, rel: Relation, sx: number, sy: number): Motives {
  const need = x.hunger * 4;
  const ratio = clamp(ln(Math.max(0.05, sx) / Math.max(0.05, sy)), -2, 2);
  const land = x.pressure * 0.8 + rel.friction * 0.8 + clamp(ratio * 0.6, -1.2, 0.6);
  const revenge = Math.min(1, grudge(rel, x.id));
  let treaty = 0;
  let freedom = 0;
  if (rel.status === 'alliance') treaty = -2;
  else if (rel.status === 'peace') treaty = world.day < rel.truceUntil ? -1.2 : -0.3;
  else if (rel.status === 'tribute') {
    if (rel.tributary === x.id) freedom = 0.4 + clamp(ratio, -1, 1) * 0.6;
    else treaty = world.day < rel.truceUntil ? -1.5 : -0.8;
  }
  const opinion = -1.5 * rel.opinion;
  // war would cut the trade and the marriages across the border
  const ties = -0.8 * rel.ties;
  return { need, land, revenge, freedom, total: need + land + revenge + freedom + treaty + opinion + ties + 0.8 * x.pol.warMood };
}

/** One person's appetite for war on top of the polity's motives. */
function personalHawk(world: World, p: Person): number {
  const young = p.sex === 1 && ageYears(world, p) < 40 ? 1 : 0.3;
  return p.hunger * 1.5 + ((p.physical - 50) / 50) * 0.4 * young + (p.risk - 0.5) * 0.8 +
    (p.ambition - 0.5) * (p.role === 'leader' ? 2 : 0.6) - (ageYears(world, p) > 50 ? 0.2 : 0);
}

const WAR_BASE = -1.5;

/** Has a spouse, mother or child of the other people or living among them (DESIGN.md §12.9). */
function kinAbroad(world: World, p: Person, y: number): boolean {
  if (p.ethnicity === y) return true;
  for (const id of [p.spouseId, p.motherId, ...p.childIds]) {
    const k = personById(world, id);
    if (k && (k.ethnicity === y || world.settlements[k.settlement].polity === y)) return true;
  }
  return false;
}

function warSupport(world: World, x: Realm, m: Motives, y: number): number {
  // warPropensity multiplies everyone's odds of favouring war
  const base = WAR_BASE + ln(Math.max(0.01, world.params.warPropensity));
  const kin = world.params.kinPeace;
  return decide(world, x, (p) => sigmoid(base + m.total + personalHawk(world, p) - (kin > 0 && kinAbroad(world, p, y) ? kin : 0)));
}

// --- yearly diplomacy ----------------------------------------------------

export function diplomacyYearly(world: World, rng: Rng): void {
  const P = world.params;
  const R = realms(world);
  // polities that have lost all their people or land
  for (const pol of allPolities(world)) {
    if (pol.alive && !R[pol.id]) extinguish(world, pol, '人口散尽');
  }
  for (const pol of allPolities(world)) pol.warMood *= 0.85;
  const strengths = R.map((r) => (r ? strength(world, r) : 0));

  // tile → polity, for border length
  const owner = world.map.tiles.map((t) => (t.owner >= 0 && world.settlements[t.owner].alive ? world.settlements[t.owner].polity : -1));
  const n = R.length;
  const border: number[] = new Array(n * n).fill(0);
  for (const t of world.map.tiles) {
    const a = owner[t.id];
    if (a < 0) continue;
    for (const nb of neighbors(world.map, t)) {
      const b = owner[nb.id];
      if (b >= 0 && b !== a) border[a * n + b]++;
    }
  }
  const means = R.map((r) => (r ? meanPrefs(r) : []));

  const declared = new Set<number>();
  for (const rel of world.relations) {
    // last year's flows of goods and people (crossborder.ts)
    rel.trade = rel.tradeAcc;
    rel.marriages = rel.marriagesAcc;
    rel.migrants = rel.migrantsAcc;
    rel.tradeAcc = rel.marriagesAcc = rel.migrantsAcc = 0;
    const A = R[rel.a];
    const B = R[rel.b];
    if (!A || !B) continue;
    const dist = minDistance(world, A, B);
    if (rel.status === 'none') {
      if (dist > P.contactRange) continue;
      rel.status = 'contact';
      rel.since = world.day;
      addEvent(world, 'diplomacy', involvesPlayer(rel.a, rel.b), `首次接触：${A.pol.name}与${B.pol.name}`,
        `${A.pol.name}与${B.pol.name}的群落相距仅 ${dist} 格，双方开始相互往来，也开始争夺边界上的猎场。`);
    }
    const len = border[rel.a * n + rel.b] + border[rel.b * n + rel.a];
    rel.friction = clamp((len / 30) * (0.3 + A.pressure + B.pressure), 0, 1);
    if (rel.status === 'war') rel.ties *= 0.7;
    else {
      const m = Math.max(20, Math.min(A.people.length, B.people.length));
      const x = rel.trade / (m * 2) + (40 * rel.marriages) / m + (10 * rel.migrants) / m;
      rel.ties = clamp(rel.ties + (1 - exp(-x) - rel.ties) * 0.3, 0, 1);
    }
    rel.grudgeA *= 0.92;
    rel.grudgeB *= 0.92;
    const sim = similarity(means[rel.a], means[rel.b]);
    // border incidents: a hunting party killed on disputed ground starts a feud
    if (rel.status !== 'war' && rng.chance(rel.friction * 0.3)) borderIncident(world, rng, rel, A, B);
    const target = (sim - 0.75) * 2 + 0.6 * rel.ties - 1.2 * rel.friction - (rel.grudgeA + rel.grudgeB) / 2 +
      (rel.status === 'alliance' ? 0.2 : 0);
    rel.opinion = clamp(rel.opinion + (target - rel.opinion) * 0.25, -1, 1);

    if (rel.status === 'tribute') payTribute(world, rel, R);
    if (rel.status === 'war') continue;

    // treaties: friendly neighbours make peace; shared threats make allies
    if (rel.status === 'contact' && rel.opinion > 0.35) setStatus(world, rel, 'peace', `${A.pol.name}与${B.pol.name}关系友好，缔结和约。`);
    else if (rel.status === 'peace' && world.day > rel.truceUntil && rel.opinion < -0.2) {
      setStatus(world, rel, 'contact', `${A.pol.name}与${B.pol.name}关系恶化，和约名存实亡。`);
    } else if (rel.status === 'alliance' && rel.opinion < 0.1) {
      setStatus(world, rel, 'peace', `${A.pol.name}与${B.pol.name}的同盟瓦解。`);
    } else if ((rel.status === 'peace' || rel.status === 'contact') && rel.opinion > 0.45 && commonEnemy(world, rel.a, rel.b)) {
      const sa = decide(world, A, (p) => sigmoid(rel.opinion * 3 - 1 - (p.risk - 0.5)));
      const sb = decide(world, B, (p) => sigmoid(rel.opinion * 3 - 1 - (p.risk - 0.5)));
      if (sa > 0.5 && sb > 0.5) {
        setStatus(world, rel, 'alliance', `面对共同的敌人，${A.pol.name}（${howDecided(A.pol)}）与${B.pol.name}（${howDecided(B.pol)}）结成同盟。`);
      }
    }

    // war: within reach, decided through each side's institutions
    if (rel.status === 'alliance' || P.warPropensity <= 0) continue;
    const reach = (pid: number) => P.campaignRange * (knows(world, pid, 'chariot') ? 1.5 : 1);
    for (const [X, Y] of [[A, B], [B, A]] as const) {
      if (declared.has(X.id) || dist > reach(X.id)) continue;
      const m = motives(world, X, rel, strengths[X.id], strengths[Y.id]);
      const sup = warSupport(world, X, m, Y.id);
      if (sup > 0.5 && rng.chance(0.3)) {
        declared.add(X.id);
        declareWar(world, X, Y, rel, m, sup, R);
        break;
      }
    }
  }

  // peace talks in ongoing wars
  for (const war of world.wars) {
    if (war.end >= 0) continue;
    const A = R[war.attacker];
    const B = R[war.defender];
    const rel = relation(world, war.attacker, war.defender)!;
    if (!A || !B) {
      endWar(world, war, rel, `${(A ?? B)?.pol.name ?? '一方'}的对手已不复存在`);
      continue;
    }
    if (world.day - war.start < DAYS_PER_YEAR) continue;
    const ma = motives(world, A, { ...rel, status: 'contact' }, strengths[A.id], strengths[B.id]);
    const mb = motives(world, B, { ...rel, status: 'contact' }, strengths[B.id], strengths[A.id]);
    const years = (world.day - war.start) / DAYS_PER_YEAR;
    // exhaustion: years in the field and the dead
    ma.total -= years * 0.15 + (war.deaths[0] / Math.max(10, A.nMen)) * 3;
    mb.total -= years * 0.15 + (war.deaths[1] / Math.max(10, B.nMen)) * 3;
    const sa = warSupport(world, A, ma, B.id);
    const sb = warSupport(world, B, mb, A.id);
    const stale = war.actions === 0 && years >= 2;
    if (sa > 0.45 && sb > 0.45 && years < 15 && !stale) continue;
    // the side that wants peace more is the one suing for it
    const [winner, loser] = sa >= sb ? [A, B] : [B, A];
    const ratio = strengths[winner.id] / Math.max(0.01, strengths[loser.id]);
    if (ratio >= 2 && Math.min(sa, sb) < 0.4 && !stale) {
      endWar(world, war, rel, `${loser.pol.name}求和，向${winner.pol.name}称臣纳贡`);
      rel.status = 'tribute';
      rel.tributary = loser.id;
      rel.since = world.day;
    } else {
      endWar(world, war, rel, stale ? '双方相距太远，战事不了了之' : `${loser.pol.name}（${howDecided(loser.pol)}）求和，双方议和`);
    }
  }

  revolts(world, rng, R);
  secession(world, rng, R);
  if (world.wars.length > MAX_ENDED_WARS) {
    const ended = world.wars.filter((w) => w.end >= 0);
    const drop = new Set(ended.slice(0, world.wars.length - MAX_ENDED_WARS).map((w) => w.id));
    world.wars = world.wars.filter((w) => !drop.has(w.id));
  }
}

function borderIncident(world: World, rng: Rng, rel: Relation, A: Realm, B: Realm): void {
  const [killer, victim] = rng.chance(0.5) ? [A, B] : [B, A];
  const men = [...victim.men.values()].flat();
  if (!men.length) return;
  const dead = rng.pick(men);
  const name = dead.name;
  bury(world, victim, [dead]);
  addGrudge(rel, victim.id, 0.25);
  addEvent(world, 'diplomacy', false, `边境冲突：${killer.pol.name} · ${victim.pol.name}`,
    `${victim.pol.name}的${name}在边界的猎场上被${killer.pol.name}的人杀死，族人誓言复仇。`, [], dead.settlement);
}

function minDistance(world: World, A: Realm, B: Realm): number {
  let d = Infinity;
  for (const s of A.settlements) {
    const ts = world.map.tiles[s.tile];
    for (const o of B.settlements) d = Math.min(d, hexDistance(ts, world.map.tiles[o.tile]));
  }
  return d;
}

function commonEnemy(world: World, a: number, b: number): boolean {
  for (const pol of allPolities(world)) {
    if (!pol.alive || pol.id === a || pol.id === b) continue;
    const ra = relation(world, a, pol.id);
    const rb = relation(world, b, pol.id);
    if (!ra || !rb || ra.status === 'none' || rb.status === 'none') continue;
    if ((ra.status === 'war' || ra.opinion < -0.1) && (rb.status === 'war' || rb.opinion < -0.1)) return true;
  }
  return false;
}

function setStatus(world: World, rel: Relation, status: Relation['status'], text: string): void {
  rel.status = status;
  rel.since = world.day;
  if (status !== 'tribute') rel.tributary = -1;
  addEvent(world, 'diplomacy', false, `${STATUS_NAMES[status]}：${polityOf(world, rel.a).name} · ${polityOf(world, rel.b).name}`, text);
}

function payTribute(world: World, rel: Relation, R: (Realm | undefined)[]): void {
  const payer = R[rel.tributary];
  const lord = R[rel.tributary === rel.a ? rel.b : rel.a];
  if (!payer || !lord) return;
  const rate = world.params.tributeRate;
  // food, tools and clothes from the treasury and from every settlement's common stores the state reaches
  const paid = { food: 0, tools: 0, clothes: 0 };
  for (const g of ['food', 'tools', 'clothes'] as const) {
    let x = payer.pol.treasury[g] * rate;
    payer.pol.treasury[g] -= x;
    for (const s of payer.settlements) {
      const y = s[g] * rate * s.enforcement;
      s[g] -= y;
      x += y;
    }
    lord.pol.treasury[g] += x;
    paid[g] = x;
  }
  addGrudge(rel, payer.id, 0.05);
  addEvent(world, 'diplomacy', false, `贡赋：${payer.pol.name} → ${lord.pol.name}`,
    `${payer.pol.name}向${lord.pol.name}缴纳贡赋：食物 ${paid.food.toFixed(0)}、工具 ${paid.tools.toFixed(1)}、衣物 ${paid.clothes.toFixed(1)}。`);
}

function declareWar(world: World, X: Realm, Y: Realm, rel: Relation, m: Motives, sup: number, R: (Realm | undefined)[]): void {
  const goals: [War['goal'], number][] = [['raid', m.need], ['land', m.land], ['revenge', m.revenge], ['independence', m.freedom]];
  let goal = goals[0];
  for (const g of goals) if (g[1] > goal[1]) goal = g;
  const broke = rel.status === 'peace' && world.day < rel.truceUntil;
  if (broke) X.pol.legitimacy = clamp(X.pol.legitimacy - 0.05, 0, 1);
  if (rel.status === 'tribute') rel.tributary = -1;
  const war = startWar(world, X.id, Y.id, goal[0], rel);
  const l = personById(world, X.pol.leaderId);
  if (l) addBio(world, l, `率${X.pol.name}向${Y.pol.name}开战（${GOAL_NAMES[war.goal]}）`);
  addEvent(world, 'war', involvesPlayer(X.id, Y.id), `宣战：${X.pol.name} → ${Y.pol.name}`,
    `${X.pol.name}${howDecided(X.pol)}向${Y.pol.name}开战（加权主战 ${Math.round(sup * 100)}%），主要动机：${GOAL_NAMES[war.goal]}。` +
    `${broke ? '这违背了停战约定，首领威信受损。' : ''}`, l ? [l.id] : []);
  // allies of the defender come to its aid
  for (const ar of world.relations) {
    if (ar.status !== 'alliance' || (ar.a !== Y.id && ar.b !== Y.id)) continue;
    const ally = ar.a === Y.id ? ar.b : ar.a;
    const AR = R[ally];
    if (!AR || ally === X.id) continue;
    const r2 = relation(world, ally, X.id)!;
    if (r2.status === 'war') continue;
    startWar(world, ally, X.id, 'ally', r2);
    addEvent(world, 'war', involvesPlayer(ally, X.id), `参战：${AR.pol.name} 援助 ${Y.pol.name}`,
      `${AR.pol.name}履行同盟义务，向${X.pol.name}宣战。`);
  }
}

function startWar(world: World, attacker: number, defender: number, goal: War['goal'], rel: Relation): War {
  rel.status = 'war';
  rel.since = world.day;
  const war: War = {
    id: world.warSeq++, attacker, defender, start: world.day, goal,
    deaths: [0, 0], loot: [0, 0], conquests: [0, 0], actions: 0, lastConquest: -DAYS_PER_YEAR, end: -1, outcome: '',
  };
  world.wars.push(war);
  return war;
}

function endWar(world: World, war: War, rel: Relation, outcome: string): void {
  war.end = world.day;
  war.outcome = outcome;
  if (rel.status === 'war') {
    rel.status = 'peace';
    rel.since = world.day;
    rel.truceUntil = world.day + TRUCE_YEARS * DAYS_PER_YEAR;
    rel.grudgeA *= 0.5;
    rel.grudgeB *= 0.5;
  }
  const a = polityOf(world, war.attacker);
  const d = polityOf(world, war.defender);
  addEvent(world, 'war', involvesPlayer(war.attacker, war.defender), `议和：${a.name} · ${d.name}`,
    `${outcome}。战争持续 ${((world.day - war.start) / DAYS_PER_YEAR).toFixed(1)} 年；${a.name}阵亡 ${war.deaths[0]} 人，${d.name}阵亡 ${war.deaths[1]} 人；` +
    `征服聚落 ${war.conquests[0]} : ${war.conquests[1]}。`);
}

function extinguish(world: World, pol: Polity, why: string): void {
  pol.alive = false;
  for (const war of world.wars) {
    if (war.end >= 0 || (war.attacker !== pol.id && war.defender !== pol.id)) continue;
    endWar(world, war, relation(world, war.attacker, war.defender)!, `${pol.name}灭亡`);
  }
  for (const rel of world.relations) if (rel.a === pol.id || rel.b === pol.id) rel.status = 'none';
  addEvent(world, 'war', true, `${pol.name}灭亡`, `${pol.name}${why}，从此不复存在。`);
}

// --- monthly campaigns ---------------------------------------------------

export function warMonthly(world: World, rng: Rng): void {
  if (!world.wars.some((w) => w.end < 0)) return;
  const R = realms(world);
  for (const war of world.wars) {
    if (war.end >= 0) continue;
    for (const side of [0, 1]) {
      const me = R[side === 0 ? war.attacker : war.defender];
      const them = R[side === 0 ? war.defender : war.attacker];
      if (!me || !them || war.end >= 0) break;
      if (!rng.chance(side === 0 ? 0.12 : 0.06)) continue;
      campaign(world, rng, war, side, me, them, R);
    }
  }
}

function campaign(world: World, rng: Rng, war: War, side: number, me: Realm, them: Realm, R: (Realm | undefined)[]): void {
  const P = world.params;
  const range = P.campaignRange * (knows(world, me.id, 'chariot') ? 1.5 : 1);
  // the nearest enemy settlement is the front
  let target: Settlement | undefined;
  let base: Settlement | undefined;
  let bd = Infinity;
  for (const t of them.settlements) {
    const tt = world.map.tiles[t.tile];
    for (const s of me.settlements) {
      const d = hexDistance(tt, world.map.tiles[s.tile]);
      if (d < bd || (d === bd && target && t.id < target.id)) {
        bd = d;
        target = t;
        base = s;
      }
    }
  }
  if (!target || !base || bd > range) return;
  war.actions++;
  const tile = world.map.tiles[target.tile];
  const fullAtk = raise(world, rng, me, tile, range, 0.8);
  const fullDef = raise(world, rng, them, tile, range * 0.5, 0.5, target.id);
  // without a clear edge, or when the motive is food, a small party raids instead of a pitched battle
  const raid = war.goal === 'raid' || me.hunger > 0.05 || fullAtk.value < fullDef.value * 2;
  const atk = raid ? raise(world, rng, me, tile, range, 0.3) : fullAtk;
  const def = raid ? raise(world, rng, them, tile, 0, 0, target.id) : fullDef;
  if (!atk.men.length) return;
  const A = atk.value * rng.range(0.75, 1.25) * (knows(world, me.id, 'chariot') ? 1.3 : 1);
  const Dv = Math.max(0.1, def.value * rng.range(0.75, 1.25) * 1.2 * (knows(world, them.id, 'palisade') ? 1.5 : 1));
  const win = A > Dv;
  const scale = raid ? 0.35 : 1;
  const lossA = clamp(P.casualtyRate * clamp(Dv / A, 0.2, 3) * scale, 0, 0.6);
  const lossD = clamp(P.casualtyRate * clamp(A / Dv, 0.2, 3) * scale, 0, 0.6);
  const deadA = atk.men.filter(() => rng.chance(lossA));
  const deadD = def.men.filter(() => rng.chance(lossD));
  bury(world, me, deadA);
  bury(world, them, deadD);
  // the fighters are away from their work, and some come home wounded
  const days = P.campaignDays;
  serve(world, rng, atk.men, raid ? days / 3 : days);
  serve(world, rng, def.men, raid ? 3 : days / 2);
  war.deaths[side] += deadA.length;
  war.deaths[1 - side] += deadD.length;
  const rel = relation(world, me.id, them.id)!;
  addGrudge(rel, them.id, deadD.length / Math.max(10, them.nMen) * 2);
  addGrudge(rel, me.id, deadA.length / Math.max(10, me.nMen) * 2);
  me.pol.warMood = clamp(me.pol.warMood - (deadA.length / Math.max(10, me.nMen)) * 1.5, -1, 1);
  them.pol.warMood = clamp(them.pol.warMood - (deadD.length / Math.max(10, them.nMen)) * 0.5, -1, 1);
  const who = involvesPlayer(me.id, them.id);
  const tally = `${me.pol.name}出动 ${atk.men.length} 人、阵亡 ${deadA.length}；${them.pol.name}迎战 ${def.men.length} 人、阵亡 ${deadD.length}`;

  if (raid) {
    if (!win) {
      addEvent(world, 'war', false, `劫掠失败：${me.pol.name} → ${target.name}`, `${me.pol.name}袭击${them.pol.name}的${target.name}被击退。${tally}。`, [], target.id);
      return;
    }
    const loot = stealFood(world, target, P.raidLoot * (A / (A + Dv)));
    base.food += loot;
    war.loot[side] += loot;
    addGrudge(rel, them.id, 0.05);
    addEvent(world, 'war', false, `劫掠：${me.pol.name} → ${target.name}`, `${me.pol.name}劫掠${them.pol.name}的${target.name}，抢走食物 ${loot.toFixed(0)}，运回${base.name}。${tally}。`, [], target.id);
    return;
  }
  // a war takes at most one settlement a year: holding new ground takes time
  if (win && A > Dv * 1.5 && world.day - war.lastConquest >= DAYS_PER_YEAR) {
    war.lastConquest = world.day;
    addEvent(world, 'war', false, `战役：${me.pol.name}攻克${target.name}`, `${me.pol.name}大举进攻${them.pol.name}的${target.name}并取胜。${tally}。`, [], target.id);
    conquer(world, rng, target, me, them, R);
    war.conquests[side]++;
    me.pol.warMood = clamp(me.pol.warMood + 0.05, -1, 1);
  } else {
    addEvent(world, 'war', who, `战役：${target.name}之战`,
      `${me.pol.name}进攻${them.pol.name}的${target.name}，${win ? '虽占上风但未能攻下' : '被守军击退'}。${tally}。`, [], target.id);
  }
}

/** Survivors of a fight: away from home for `days`, some wounded. */
function serve(world: World, rng: Rng, men: Person[], days: number): void {
  for (const p of men) {
    if (!personById(world, p.id)) continue; // fell
    p.away = Math.max(p.away, world.day + Math.round(days));
    if (rng.chance(world.params.woundRate)) p.health = Math.max(0.05, p.health - rng.range(0.15, 0.4));
  }
}

function bury(world: World, r: Realm, dead: Person[], cause = '战死'): void {
  if (!dead.length) return;
  const ids = new Set(dead.map((p) => p.id));
  for (const [sid, men] of r.men) r.men.set(sid, men.filter((p) => !ids.has(p.id)));
  r.nMen -= dead.length;
  r.people = r.people.filter((p) => !ids.has(p.id));
  r.adults = r.adults.filter((p) => !ids.has(p.id));
  scopeOf(world, r.id).yearAcc.deaths += dead.length;
  // the bereaved grieve and want revenge
  for (const p of dead) {
    for (const id of [p.spouseId, p.fatherId, p.motherId, ...p.childIds]) {
      const k = personById(world, id);
      if (k) k.grievance = clamp(k.grievance + 0.1, 0, 1);
    }
  }
  killPeople(world, dead, cause);
}

function stealFood(world: World, s: Settlement, frac: number): number {
  let got = s.food * frac;
  s.food -= got;
  for (const p of world.people) {
    if (p.settlement !== s.id) continue;
    const x = p.food * frac * 0.5;
    p.food -= x;
    got += x;
  }
  return got;
}

/**
 * A settlement changes hands with its land and people. The men and boys of the conquered people are
 * put to the sword; women and children of the victors' own people are spared and keep their culture.
 */
function conquer(world: World, rng: Rng, s: Settlement, winner: Realm, loser: Realm, R: (Realm | undefined)[]): void {
  const lpol = loser.pol;
  const captured: Person[] = [];
  const victims = world.people.filter((p) => p.settlement === s.id && p.sex === 1 && p.ethnicity !== winner.id && rng.chance(world.params.conquestMassacre));
  const slainLeader = victims.find((p) => p.role === 'leader');
  for (const p of victims) addBio(world, p, `${s.name}被${winner.pol.name}攻破`);
  bury(world, loser, victims, '城破后被屠杀');
  for (const p of world.people) {
    if (p.settlement !== s.id) continue;
    if (p.role !== 'none') {
      addBio(world, p, `${s.name}被${winner.pol.name}攻占，失去${p.role === 'leader' ? '首领' : p.role === 'governor' ? '镇守' : p.role === 'chief' ? '头人' : '长老'}之位`);
      if (p.role === 'leader') captured.push(p);
      p.role = 'none';
    }
    if (p.occ === OCC.admin) p.occ = OCC.gather;
    p.grievance = clamp(p.grievance + 0.3, 0, 1);
    const sp = personById(world, p.spouseId);
    if (sp && sp.settlement !== s.id && world.settlements[sp.settlement].polity !== winner.id) {
      // separated by the new border
      sp.spouseId = -1;
      p.spouseId = -1;
    }
  }
  lpol.councilIds = lpol.councilIds.filter((id) => personById(world, id)?.settlement !== s.id);
  s.polity = winner.id;
  s.conquered = world.day;
  s.stressMonths = 0;
  loser.settlements = loser.settlements.filter((x) => x.id !== s.id);
  winner.settlements.push(s);
  const rel = relation(world, winner.id, loser.id)!;
  addGrudge(rel, loser.id, 0.5);
  if (s.origin === winner.id) s.conquered = -1; // a lost settlement taken back
  s.governor = -1;
  s.chief = -1;
  const settlers = victims.length ? settle(world, s, winner) : 0;
  const gov = s.origin === winner.id ? undefined : appointGovernor(world, s);
  addEvent(world, 'war', involvesPlayer(winner.id, loser.id), `征服：${s.name}归属${winner.pol.name}`,
    `${s.name}（${s.pop} 人）被${winner.pol.name}征服${s.origin === winner.id ? '（收复故地）' : '，幸存的居民保留着自己的习俗，对新统治者心怀不满'}。` +
    `${victims.length ? `城中 ${victims.length} 名${lpol.name}男子被屠杀。` : ''}` +
    `${slainLeader ? `首领${slainLeader.name}被杀。` : captured.length ? `${lpol.name}的首领${captured[0].name}被俘。` : ''}` +
    `${settlers ? `${winner.pol.name}的 ${settlers} 名单身男子迁入，娶当地妇女为妻。` : ''}` +
    `${gov ? `${winner.pol.name}派${gov.name}镇守${s.name}。` : ''}`, captured.map((p) => p.id), s.id);
  if (!loser.settlements.length) {
    extinguish(world, lpol, `的最后一个聚落${s.name}被${winner.pol.name}攻占`);
    R[loser.id] = undefined;
    return;
  }
  if (lpol.capital === s.id) {
    let cap = loser.settlements[0];
    for (const x of loser.settlements) if (x.pop > cap.pop) cap = x;
    lpol.capital = cap.id;
    lpol.legitimacy = clamp(lpol.legitimacy - 0.15, 0, 1);
    inPolity(world, lpol.id, (v) => {
      if (!personById(v, v.polity.leaderId)) chooseLeader(v, rng, `都城${s.name}陷落`);
      updateEnforcement(v);
    });
  }
}

/** Unmarried young men of the victors move into a settlement whose men were killed, to take wives there. */
function settle(world: World, s: Settlement, winner: Realm): number {
  const women = world.people.filter((p) => p.settlement === s.id && p.sex === 0 && p.spouseId < 0 && ageYears(world, p) >= ADULT_AGE && ageYears(world, p) < 45).length;
  if (!women) return 0;
  const here = world.map.tiles[s.tile];
  const near = new Set(winner.settlements.filter((x) => x.id !== s.id && hexDistance(here, world.map.tiles[x.tile]) <= world.params.campaignRange).map((x) => x.id));
  const bachelors = world.people
    .filter((p) => near.has(p.settlement) && p.sex === 1 && p.spouseId < 0 && p.role === 'none' && ageYears(world, p) >= ADULT_AGE && ageYears(world, p) < 40)
    .sort((a, b) => a.id - b.id)
    .slice(0, women);
  for (const p of bachelors) {
    addBio(world, p, `迁入新征服的${s.name}`);
    p.settlement = s.id;
    p.plots = 0;
  }
  return bachelors.length;
}

/**
 * The conquerors put one of their own in charge of a conquered settlement: a man of the ruling people
 * already there, or one brought in with his household from a nearby home settlement. Prestige and
 * kinship with the ruler count.
 */
function appointGovernor(world: World, s: Settlement, outsider = false): Person | undefined {
  const ruler = s.polity;
  const cur = personById(world, s.governor);
  if (cur && cur.settlement === s.id && cur.role === 'governor') return cur;
  const lord = personById(world, polityOf(world, ruler).leaderId);
  const here = world.map.tiles[s.tile];
  let best: Person | undefined;
  let bs = -Infinity;
  for (const p of world.people) {
    if (p.role !== 'none' || p.ethnicity !== ruler || p.sex !== 1) continue;
    const home = world.settlements[p.settlement];
    if (home.polity !== ruler || (home.id !== s.id && home.origin !== ruler) || (outsider && home.id === s.id)) continue;
    const age = ageYears(world, p);
    if (age < 25 || age > 60) continue;
    const d = hexDistance(here, world.map.tiles[home.tile]);
    if (d > world.params.campaignRange) continue;
    const kin = lord && p.name[0] === lord.name[0] ? 1 : 0;
    const sc = p.prestige + kin + (home.id === s.id ? 0.5 : 0) + (p.social - 50) / 100 - d * 0.02;
    if (sc > bs || (sc === bs && best && p.id < best.id)) {
      bs = sc;
      best = p;
    }
  }
  if (!best) return undefined;
  if (best.settlement !== s.id) {
    const from = world.settlements[best.settlement];
    const household = [best, personById(world, best.spouseId), ...best.childIds.map((id) => personById(world, id))]
      .filter((k): k is Person => !!k && k.settlement === from.id && (k === best || k.id === best!.spouseId || ageYears(world, k) < ADULT_AGE));
    for (const k of household) {
      k.settlement = s.id;
      k.plots = 0;
    }
  }
  best.role = 'governor';
  best.notable = true;
  if (best.occ === OCC.admin) best.occ = OCC.gather;
  s.governor = best.id;
  addBio(world, best, `受${polityOf(world, ruler).name}委派镇守${s.name}`);
  return best;
}

/** End a settlement's governorship (assimilated, or lost). */
function dismissGovernor(world: World, s: Settlement): Person | undefined {
  const g = personById(world, s.governor);
  s.governor = -1;
  if (!g || g.role !== 'governor') return undefined;
  g.role = 'none';
  return g;
}

// --- revolts of conquered settlements -----------------------------------

function revolts(world: World, rng: Rng, R: (Realm | undefined)[]): void {
  for (const s of world.settlements) {
    if (!s.alive || s.origin === s.polity) continue;
    if (s.conquered >= 0 && world.day - s.conquered > ASSIMILATE_YEARS * DAYS_PER_YEAR) {
      s.origin = s.polity;
      const g = dismissGovernor(world, s);
      if (g) addBio(world, g, `${s.name}已被同化，卸下镇守之职`);
      addEvent(world, 'misc', false, `同化：${s.name}`, `${s.name}的居民已经视自己为${polityOf(world, s.polity).name}的一部分。`, [], s.id);
      continue;
    }
    const ruler = R[s.polity];
    if (!ruler) continue;
    const cur = personById(world, s.governor);
    if (!cur || cur.settlement !== s.id || cur.role !== 'governor') {
      const ng = appointGovernor(world, s);
      if (ng) addEvent(world, 'war', s.polity === PLAYER, `新镇守：${s.name}`, `${ruler.pol.name}派${ng.name}镇守${s.name}。`, [ng.id], s.id);
    }
    // the conquered rise up; the conquerors' own settlers do not
    const locals = world.people.filter((p) => p.settlement === s.id && ageYears(world, p) >= ADULT_AGE && p.ethnicity !== s.polity);
    if (locals.length < 10) continue;
    let g = 0;
    for (const p of locals) g += p.grievance;
    g /= locals.length;
    const chance = clamp((g - 0.3) * 1.5 + (1 - s.enforcement) * 0.25 - ruler.pol.legitimacy * 0.3, 0, 0.4);
    if (!rng.chance(chance)) continue;
    const tile = world.map.tiles[s.tile];
    const rebels = locals.filter((p) => fighter(world, p) > 0 && p.grievance > 0.3);
    let rv = 0;
    for (const p of rebels) rv += fighter(world, p);
    rv *= weapons(world, ruler.id) * 1.2;
    const garrison = raise(world, rng, ruler, tile, world.params.campaignRange * 0.5, 0.4, -1);
    const home = polityOf(world, s.origin);
    const who = involvesPlayer(s.polity, s.origin);
    if (rv * rng.range(0.7, 1.3) > garrison.value) {
      const old = ruler.pol;
      const killed = garrison.men.filter(() => rng.chance(0.08));
      bury(world, ruler, killed);
      const gov = dismissGovernor(world, s);
      if (gov && gov.settlement === s.id) bury(world, ruler, [gov], '被起义者所杀'); // the conquerors' man dies first
      if (home.alive) {
        s.polity = s.origin;
        s.conquered = -1;
        addEvent(world, 'war', who, `起义：${s.name}回归${home.name}`, `${s.name}的居民起义，赶走了${old.name}的统治，重新归附${home.name}。`, [], s.id);
      } else {
        independence(world, rng, s, locals);
        addEvent(world, 'war', who, `起义：${s.name}独立`, `${s.name}的居民起义，摆脱了${old.name}的统治，建立了${polityOf(world, s.polity).name}。`, [], s.id);
      }
      for (const p of locals) p.grievance *= 0.5;
      if (old.capital === s.id) {
        const rest = world.settlements.filter((x) => x.alive && x.polity === old.id);
        if (rest.length) old.capital = rest[0].id;
      }
      ruler.settlements = ruler.settlements.filter((x) => x.id !== s.id);
      if (!ruler.settlements.length) extinguish(world, old, '失去了所有聚落');
    } else {
      const killed = rebels.filter(() => rng.chance(0.15));
      bury(world, R[s.polity]!, killed);
      for (const p of locals) p.grievance = clamp(p.grievance + 0.1, 0, 1);
      addEvent(world, 'war', who, `起义被镇压：${s.name}`, `${s.name}的居民反抗${ruler.pol.name}的统治，被镇压，约 ${killed.length} 人死难。`, [], s.id);
    }
  }
}

/** Rebels whose old homeland is gone found a new polity with the customs they prefer. */
function independence(world: World, rng: Rng, s: Settlement, locals: Person[]): void {
  const ruler = scopeOf(world, s.polity);
  const id = world.npcs.length + 1;
  const sc = newScope(rng, id, UNSPECIFIED);
  // they keep what they knew
  sc.tech.known = [...ruler.tech.known];
  sc.tech.day = [...ruler.tech.day];
  sc.tech.inventor = [...ruler.tech.inventor];
  sc.era = ruler.era;
  sc.polity.institutions = DIMS.map((_, d) => {
    const n = DIMS[d].options.length;
    const mean = new Array<number>(n).fill(0);
    for (const p of locals) for (let o = 0; o < n; o++) mean[o] += p.prefs[d][o];
    let best = 0;
    for (let o = 1; o < n; o++) if (mean[o] > mean[best]) best = o;
    return best;
  });
  sc.polity.active = [...ruler.polity.active];
  const taken = takenNames(world);
  sc.polity.name = `${s.name}${rng.pick(['部', '氏', '邦'])}`;
  if (taken.has(sc.polity.name)) sc.polity.name = polityName(rng, taken);
  sc.polity.capital = s.id;
  world.npcs.push(sc);
  s.polity = id;
  s.origin = id;
  s.conquered = -1;
  initRelations(world);
  const rel = relation(world, id, ruler.polity.id)!;
  rel.status = 'contact';
  addGrudge(rel, id, 0.5);
  inPolity(world, id, (v) => {
    chooseLeader(v, rng, '起义建国');
    chooseCouncil(v);
    appointAdmins(v);
    updateEnforcement(v);
  });
}

// --- secession of settlements beyond the state's reach -------------------

const MAX_YEARLY_SECESSION = 0.3;

function localPrefs(people: Person[]): number[][] {
  return meanPrefs({ adults: people } as Realm);
}

/**
 * Own settlements the state no longer reaches (enforcement below the threshold) pay little tax, follow
 * their own customs and cost the ruler legitimacy. Each year they may break away: join a strong
 * neighbour with similar customs, or go their own way. The ruler may try to hold them by force;
 * a settlement held that way gets a governor from the core and keeps resenting it.
 */
function secession(world: World, rng: Rng, R: (Realm | undefined)[]): void {
  const P = world.params;
  const out = new Map<number, number>(); // ruler -> people out of reach
  for (const s of world.settlements) {
    if (!s.alive || s.origin !== s.polity) continue;
    const ruler = R[s.polity];
    if (!ruler || s.id === ruler.pol.capital) continue;
    const folk = world.people.filter((p) => p.settlement === s.id);
    const gov = personById(world, s.governor);
    const held = !!gov && gov.settlement === s.id && gov.role === 'governor';
    if (held) for (const p of folk) if (p !== gov) p.grievance = clamp(p.grievance + 0.04, 0, 1); // ruled by an outsider
    if (s.enforcement >= P.enforceThreshold) continue;
    // vassals run their own affairs and mostly stay; land beyond reach is a burden and drifts away
    const vassal = s.enforcement >= P.vassalThreshold;
    out.set(ruler.id, (out.get(ruler.id) ?? 0) + folk.length * (vassal ? 0.3 : 1));
    const locals = folk.filter((p) => ageYears(world, p) >= ADULT_AGE);
    if (locals.length < 10) continue;
    if (!vassal) for (const p of locals) p.grievance = clamp(p.grievance + 0.02, 0, 1); // taxed, but neither protected nor fed
    let g = 0;
    for (const p of locals) g += p.grievance;
    g /= locals.length;
    const mine = localPrefs(locals);
    const gap = 1 - similarity(mine, meanPrefs(ruler));
    const remote = clamp((P.enforceThreshold - s.enforcement) / P.enforceThreshold, 0, 1);
    // an ambitious headman with his own following pushes for it
    const chief = personById(world, s.chief);
    const lordly = chief && chief.role === 'chief' && chief.settlement === s.id ? (chief.ambition - 0.5) * 0.4 : 0;
    const want = remote * 0.4 + (g - 0.2) * 0.8 + gap * 1.5 + lordly - ruler.pol.legitimacy * 0.3;
    if (!rng.chance(clamp(want * 0.5 * P.secession * (vassal ? 0.3 : 1), 0, MAX_YEARLY_SECESSION))) continue;

    // a strong neighbour with similar ways nearby is worth joining
    const here = world.map.tiles[s.tile];
    const ownStr = Math.max(0.1, strength(world, ruler));
    let to: Realm | undefined;
    let best = 0;
    for (const nb of R) {
      if (!nb || nb.id === ruler.id || !nb.settlements.length) continue;
      const r = relation(world, nb.id, ruler.id);
      if (!r || r.status === 'alliance' || r.status === 'none') continue;
      let d = Infinity;
      for (const x of nb.settlements) d = Math.min(d, hexDistance(here, world.map.tiles[x.tile]));
      if (d > P.contactRange) continue;
      const score = similarity(mine, meanPrefs(nb)) * 2 + clamp(ln(Math.max(0.1, strength(world, nb)) / ownStr), -1, 1) * 0.5 - (d / P.contactRange) * 0.5;
      if (score > best) {
        best = score;
        to = nb;
      }
    }
    if (best < 1.2) to = undefined;

    // the ruler tries to keep it, if the men are there
    const who = involvesPlayer(ruler.id, to?.id ?? -1);
    const fighters = locals.filter((p) => fighter(world, p) > 0);
    let rv = 0;
    for (const p of fighters) rv += fighter(world, p);
    rv *= weapons(world, ruler.id);
    const force = raise(world, rng, ruler, here, P.campaignRange, 0.4, -1);
    if (force.value > rv * 1.5 && rng.chance(0.3 + 0.5 * ruler.pol.legitimacy)) {
      const killed = fighters.filter(() => rng.chance(0.1));
      bury(world, ruler, killed, '抗拒官府被杀');
      for (const p of locals) p.grievance = clamp(p.grievance + 0.15, 0, 1);
      ruler.pol.legitimacy = clamp(ruler.pol.legitimacy - 0.05, 0, 1);
      const ng = held ? gov : appointGovernor(world, s, true);
      addEvent(world, 'war', who, `强留：${s.name}`,
        `${s.name}想${to ? `投靠${to.pol.name}` : '自立'}，${ruler.pol.name}出兵强行留住了它，${killed.length} 人被杀。` +
        `${ng && !held ? `${ng.name}被派去镇守。` : ''}当地人怨恨更深，首领威信受损。`, ng ? [ng.id] : [], s.id);
      continue;
    }

    const old = ruler.pol;
    if (held) {
      const gv = dismissGovernor(world, s);
      if (gv) bury(world, ruler, [gv], '被分离者所杀');
    }
    for (const p of folk) {
      if (p.role === 'council' || p.role === 'chief') p.role = 'none';
      if (p.occ === OCC.admin) p.occ = OCC.gather;
    }
    s.chief = -1;
    old.councilIds = old.councilIds.filter((id) => personById(world, id)?.settlement !== s.id);
    ruler.settlements = ruler.settlements.filter((x) => x.id !== s.id);
    if (to) {
      s.polity = to.id;
      s.origin = to.id; // joined of their own will: not a conquered people
      s.conquered = -1;
      to.settlements.push(s);
      for (const p of folk) p.grievance *= 0.6;
      addGrudge(relation(world, to.id, old.id)!, old.id, 0.4);
      addEvent(world, 'war', who, `投靠：${s.name}归附${to.pol.name}`,
        `${s.name}离${old.name}的都城太远，管不到也护不住，${s.pop} 名居民转而投靠了邻近的${to.pol.name}。`, [], s.id);
    } else {
      independence(world, rng, s, locals);
      for (const p of folk) p.grievance *= 0.5;
      const r = relation(world, s.polity, old.id);
      if (r) addGrudge(r, old.id, 0.4);
      addEvent(world, 'war', who, `分离：${s.name}自立`,
        `${s.name}离${old.name}的都城太远，不再听从号令，建立了${polityOf(world, s.polity).name}。`, [], s.id);
    }
    if (!ruler.settlements.length) extinguish(world, old, '失去了所有聚落');
  }
  // holding land the state cannot govern costs the ruler standing
  for (const [id, n] of out) {
    const r = R[id];
    if (!r || !r.people.length) continue;
    r.pol.legitimacy = clamp(r.pol.legitimacy - 0.1 * (n / r.people.length), 0, 1);
  }
}

// --- interface for the rest of the simulation --------------------------

/** Demand for military techs: at war, or with hostile neighbours (runs on a polity view). */
export function warDemand(world: World): number {
  const id = world.polity.id;
  let d = 0;
  for (const rel of world.relations) {
    if (rel.a !== id && rel.b !== id) continue;
    if (rel.status === 'war') return 0.9;
    if (rel.status === 'none') continue;
    d = Math.max(d, clamp(-rel.opinion, 0, 1) * 0.6 + grudge(rel, id) * 0.3);
  }
  return clamp(d, 0, 1);
}

/** The player's war/peace current: shifts the polity's mood, which everyone's war support includes. */
export function pushWarMood(world: World, pid: number, value: number): void {
  const pol = polityOf(world, pid);
  pol.warMood = clamp(pol.warMood + value, -1, 1);
  addEvent(world, 'movement', true, value > 0 ? '思潮兴起：主战' : '思潮兴起：主和',
    value > 0 ? '有人在部落里鼓吹对外用兵，宣扬掠夺与扩张。人们按各自利益决定是否响应。' : '有人在部落里呼吁与邻族和睦相处，反对流血。人们按各自利益决定是否响应。');
}

export interface Outlook {
  from: number;
  to: number;
  support: number;
  motives: Motives;
  strength: number;
  enemyStrength: number;
}

/** How much each polity currently wants war with each neighbour it knows (for the UI and experiments). */
export function warOutlook(world: World): Outlook[] {
  const R = realms(world);
  const st = R.map((r) => (r ? strength(world, r) : 0));
  const out: Outlook[] = [];
  for (const rel of world.relations) {
    const A = R[rel.a];
    const B = R[rel.b];
    if (!A || !B || rel.status === 'none') continue;
    for (const [X, Y] of [[A, B], [B, A]] as const) {
      const m = motives(world, X, rel, st[X.id], st[Y.id]);
      out.push({ from: X.id, to: Y.id, support: warSupport(world, X, m, Y.id), motives: m, strength: st[X.id], enemyStrength: st[Y.id] });
    }
  }
  return out;
}
