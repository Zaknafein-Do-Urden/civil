// Real flows between polities (DESIGN.md §12.9): border markets, intermarriage and refugees.
// Runs monthly on the whole world, after every polity's own monthly pass. What flows here is
// what the yearly `ties` between two polities is made of (war.ts diplomacyYearly).

import { clamp, exp } from './dmath';
import { ALLOC, D } from './rules';
import { addBio, ageYears, personById } from './person';
import { addEvent } from './events';
import { hexDistance } from './map';
import { TECH_INDEX } from './tech';
import { bestStone, foodNeed } from './economy';
import { PLAYER, allPolities, polityOf, scopeOf } from './nations';
import { relation } from './war';
import type { Rng } from './rng';
import { ADULT_AGE, OCC } from './types';
import type { Person, Relation, RelationStatus, Settlement, World } from './types';

type Good = 'food' | 'tools' | 'clothes' | 'hides';
type Ware = Exclude<Good, 'food'>;
const WARES: Ware[] = ['tools', 'clothes', 'hides'];
/** Barter value of a ware in food when it is as plentiful as people want. */
const BASE: Record<Ware, number> = { tools: 5, clothes: 8, hides: 3 };
/** Food stores people aim for, in days. */
const FOOD_DAYS = 90;
const ORE_PRICE = 4;
/** Monthly ore wanted per head for a full supply. */
const ORE_NEED = 0.005;
const REFUGE_RANGE = 8;

const MARRIAGE_STATUS: Record<RelationStatus, number> = { none: 0, war: 0, contact: 0.4, tribute: 0.6, peace: 1, alliance: 1.5 };

function knows(world: World, pid: number, tech: string): boolean {
  return scopeOf(world, pid).tech.known[TECH_INDEX[tech]];
}

/** A settlement as a market: its people, stocks (pool + private), wants and valuations. */
interface Local {
  s: Settlement;
  people: Person[];
  needs: number[];
  need: number;
  pooled: boolean;
  stock: Record<Good, number>;
  target: Record<Good, number>;
  /** Value of one unit of each ware, in food. */
  r: Record<Ware, number>;
}

function scarcity(stock: number, target: number): number {
  if (target <= 0) return 0.3;
  return clamp(Math.sqrt(target / Math.max(stock, 0.05 * target)), 0.3, 4);
}

function buildLocals(world: World): (Local | undefined)[] {
  const out: (Local | undefined)[] = world.settlements.map(() => undefined);
  for (const s of world.settlements) {
    if (!s.alive) continue;
    out[s.id] = {
      s, people: [], needs: [], need: 0, pooled: s.practiced[D.allocation] !== ALLOC.exchange,
      stock: { food: s.food, tools: s.tools, clothes: s.clothes, hides: s.hides },
      target: { food: 0, tools: 0, clothes: 0, hides: 0 },
      r: { tools: 0, clothes: 0, hides: 0 },
    };
  }
  for (const p of world.people) {
    const L = out[p.settlement];
    if (!L) continue;
    const n = foodNeed(world, p);
    L.people.push(p);
    L.needs.push(n);
    L.need += n;
    L.stock.food += p.food;
    L.stock.tools += p.tools;
    L.stock.clothes += p.clothes;
  }
  for (let i = 0; i < out.length; i++) {
    const L = out[i];
    if (!L) continue;
    if (!L.people.length) {
      out[i] = undefined;
      continue;
    }
    const n = L.people.length;
    const cold = clamp((12 - world.map.tiles[L.s.tile].temp) / 15, 0.15, 1);
    const weaving = knows(world, L.s.polity, 'weaving');
    L.target = { food: FOOD_DAYS * L.need, tools: 0.5 * n, clothes: 0.4 * cold * n, hides: weaving ? 0 : 0.2 * cold * n };
    value(L, weaving);
  }
  return out;
}

/** Relative scarcity: market prices where there is exchange, barter estimates from stocks otherwise. */
function value(L: Local, weaving = false): void {
  const hideF = weaving ? 0.3 : 1;
  if (!L.pooled) {
    L.r.tools = L.s.toolPrice;
    L.r.clothes = L.s.clothesPrice;
    L.r.hides = L.s.clothesPrice * 0.5 * hideF;
    return;
  }
  const sf = scarcity(L.stock.food, L.target.food);
  for (const g of WARES) L.r[g] = (BASE[g] * (g === 'hides' ? hideF : 1) * scarcity(L.stock[g], L.target[g])) / sf;
}

// --- who gives and who gets ------------------------------------------------

type Holder = { food: number; tools: number; clothes: number; hides?: number };
type Share = [Holder, number][];

function reserve(L: Local, h: Holder, g: Good, i: number): number {
  if (h === L.s) return g === 'food' ? (L.pooled ? 30 * L.need : 0) : g === 'tools' ? 0.2 * L.people.length : g === 'clothes' ? 0.1 * L.people.length : 0;
  return g === 'food' ? 30 * L.needs[i] : 1;
}

function available(L: Local, g: Good): Share {
  const out: Share = [];
  const pool = L.s[g] - reserve(L, L.s, g, -1);
  if (pool > 0) out.push([L.s, pool]);
  if (g === 'hides') return out;
  for (let i = 0; i < L.people.length; i++) {
    const p = L.people[i];
    const x = p[g] - reserve(L, p, g, i);
    if (x > 0) out.push([p, x]);
  }
  return out;
}

function total(sh: Share): number {
  let t = 0;
  for (const [, x] of sh) t += x;
  return t;
}

/** Take up to `q` of a good, the pool first, then private surpluses in proportion. */
function take(L: Local, g: Good, q: number): Share {
  const av = available(L, g);
  const out: Share = [];
  let left = q;
  if (av.length && av[0][0] === L.s) {
    const x = Math.min(av[0][1], left);
    L.s[g] -= x;
    left -= x;
    out.push([L.s, x]);
    av.shift();
  }
  const t = total(av);
  if (left > 0 && t > 0) {
    const f = Math.min(1, left / t);
    for (const [h, x] of av) {
      const y = x * f;
      (h as Person)[g as 'food'] -= y;
      out.push([h, y]);
    }
  }
  L.stock[g] -= total(out);
  return out;
}

/** Hand `amount` of a good to those who put something in, in proportion (hides always to the pool). */
function credit(L: Local, sh: Share, g: Good, amount: number): void {
  L.stock[g] += amount;
  const t = total(sh);
  if (g === 'hides' || t <= 0) {
    L.s[g] += amount;
    return;
  }
  for (const [h, x] of sh) (h as Holder)[g as 'food'] += (amount * x) / t;
}

// --- trade -------------------------------------------------------------

/** How much easier travel is with boats, wheels, sails and roads; averaged over both sides' know-how. */
function transport(world: World, a: Settlement, b: Settlement): number {
  const ta = world.map.tiles[a.tile];
  const tb = world.map.tiles[b.tile];
  const water = ta.river || ta.coast || tb.river || tb.coast;
  const f = (pid: number) => (knows(world, pid, 'boats') && water ? 1.25 : 1) * (knows(world, pid, 'wheel') ? 1.3 : 1) *
    (knows(world, pid, 'sailing') && ta.coast && tb.coast ? 1.5 : 1) * (knows(world, pid, 'relay') ? 1.25 : 1);
  return (f(a.polity) + f(b.polity)) / 2;
}

interface Pair {
  x: Local;
  y: Local;
  d: number;
  rel: Relation;
}

/** Each settlement meets the nearest settlement of every neighbour it is at peace with. */
function borderPairs(world: World, locals: (Local | undefined)[], range: number): Pair[] {
  const pairs = new Map<string, Pair>();
  const live = locals.filter((L): L is Local => !!L);
  for (const X of live) {
    const tx = world.map.tiles[X.s.tile];
    const nearest = new Map<number, [Local, number]>();
    for (const Y of live) {
      if (Y.s.polity === X.s.polity) continue;
      const d = hexDistance(tx, world.map.tiles[Y.s.tile]);
      if (d > range) continue;
      const cur = nearest.get(Y.s.polity);
      if (!cur || d < cur[1] || (d === cur[1] && Y.s.id < cur[0].s.id)) nearest.set(Y.s.polity, [Y, d]);
    }
    for (const [pid, [Y, d]] of nearest) {
      const rel = relation(world, X.s.polity, pid);
      if (!rel || rel.status === 'none' || rel.status === 'war') continue;
      const [a, b] = X.s.id < Y.s.id ? [X, Y] : [Y, X];
      const key = `${a.s.id}-${b.s.id}`;
      if (!pairs.has(key)) pairs.set(key, { x: a, y: b, d, rel });
    }
  }
  return [...pairs.values()].sort((p, q) => p.x.s.id - q.x.s.id || p.y.s.id - q.y.s.id);
}

interface OreBook {
  own: { copper: boolean; tin: boolean }[];
  /** Units still wanted and units bought this month, per polity. */
  want: { copper: number; tin: number }[];
  got: { copper: number; tin: number }[];
}

function oreBook(world: World): OreBook {
  const pols = allPolities(world);
  const own = pols.map(() => ({ copper: false, tin: false }));
  const pop = pols.map(() => 0);
  for (const s of world.settlements) {
    if (!s.alive) continue;
    pop[s.polity] += s.pop;
    for (const id of s.territory) {
      const t = world.map.tiles[id];
      if (t.copper) own[s.polity].copper = true;
      if (t.tin) own[s.polity].tin = true;
    }
  }
  const want = pols.map((pol, i) => {
    const needCu = !own[i].copper && (knows(world, pol.id, 'pottery') || knows(world, pol.id, 'copper'));
    const needSn = !own[i].tin && knows(world, pol.id, 'copper');
    return { copper: needCu ? ORE_NEED * pop[i] : 0, tin: needSn ? ORE_NEED * pop[i] : 0 };
  });
  return { own, want, got: pols.map(() => ({ copper: 0, tin: 0 })) };
}

/** One month of trade at one border market. Returns the value traded (food units). */
function tradePair(world: World, pair: Pair, ore: OreBook): number {
  const P = world.params;
  const { x, y } = pair;
  const dEff = pair.d / transport(world, x.s, y.s);
  let cap = P.tradeRate * Math.min(x.people.length, y.people.length) * exp(-dEff / 4);
  const lossG = clamp(dEff * 0.01, 0, 0.8);
  const lossF = clamp(dEff * 0.04, 0, 0.8);
  let traded = 0;
  for (const g of WARES) {
    value(x, knows(world, x.s.polity, 'weaving'));
    value(y, knows(world, y.s.polity, 'weaving'));
    const [E, I] = x.r[g] <= y.r[g] ? [x, y] : [y, x];
    const rE = E.r[g];
    const rI = I.r[g];
    // both sides must gain after what is lost on the road
    if (rI * (1 - lossG) * (1 - lossF) <= rE * 1.05) continue;
    const price = Math.sqrt((rE / (1 - lossF)) * rI * (1 - lossG));
    const want = Math.max(0, I.target[g] - I.stock[g]) / (1 - lossG);
    const q = Math.min(total(available(E, g)), want, total(available(I, 'food')) / price, cap / price);
    if (q < 0.5) continue;
    const goods = take(E, g, q);
    const qq = total(goods);
    const pay = take(I, 'food', qq * price);
    const paid = total(pay);
    credit(E, goods, 'food', paid * (1 - lossF));
    // in pooled settlements what comes in goes to the common store; with exchange, to whoever paid
    credit(I, I.pooled ? [] : pay, g, qq * (1 - lossG));
    cap -= paid;
    traded += paid;
  }
  // ore for those who lack mines of their own
  for (const m of ['copper', 'tin'] as const) {
    for (const [E, I] of [[x, y], [y, x]] as const) {
      const wi = ore.want[I.s.polity];
      if (wi[m] <= 0 || !ore.own[E.s.polity][m] || cap <= 0) continue;
      const units = Math.min(wi[m], cap / ORE_PRICE, total(available(I, 'food')) / ORE_PRICE);
      if (units <= 0) continue;
      const pay = total(take(I, 'food', units * ORE_PRICE));
      credit(E, [], 'food', pay * (1 - lossF)); // the miners' settlement
      wi[m] -= pay / ORE_PRICE;
      ore.got[I.s.polity][m] += pay / ORE_PRICE;
      cap -= pay;
      traded += pay;
    }
  }
  // building stone for toolmakers whose own quarries are poor
  for (const [E, I] of [[x, y], [y, x]] as const) {
    const stone = bestStone(world, E.s);
    if (stone < Math.max(bestStone(world, I.s), I.s.importStone) + 0.2) continue;
    const makers = I.people.filter((p) => p.occ === OCC.tool).length;
    if (!makers) continue;
    const pay = total(take(I, 'food', Math.min(makers * 2, Math.max(0, cap))));
    if (pay < makers) continue;
    credit(E, [], 'food', pay * (1 - lossF));
    I.s.importStone = Math.max(I.s.importStone, stone * (1 - lossG));
    cap -= pay;
    traded += pay;
  }
  return traded;
}

function trade(world: World, locals: (Local | undefined)[]): void {
  const P = world.params;
  for (const s of world.settlements) if (s.alive) s.importStone *= 0.9;
  const ore = oreBook(world);
  if (P.tradeRate > 0 && P.tradeRange > 0) {
    for (const pair of borderPairs(world, locals, P.tradeRange)) {
      const v = tradePair(world, pair, ore);
      if (v <= 0) continue;
      const rel = pair.rel;
      if (rel.trade === 0 && rel.tradeAcc === 0 && rel.ties < 0.01) {
        const a = polityOf(world, rel.a);
        const b = polityOf(world, rel.b);
        addEvent(world, 'diplomacy', rel.a === PLAYER || rel.b === PLAYER, `互市：${a.name} · ${b.name}`,
          `${pair.x.s.name}与${pair.y.s.name}的人开始在边界上交换工具、衣物、兽皮和粮食。`, [], pair.x.s.id);
      }
      rel.tradeAcc += v;
    }
  }
  // supply of ore: steady imports, or one's own mines
  allPolities(world).forEach((pol, i) => {
    for (const m of ['copper', 'tin'] as const) {
      const need = ore.want[i][m] + ore.got[i][m];
      pol.imports[m] = pol.imports[m] * 0.9 + (need > 0 ? 0.1 * clamp(ore.got[i][m] / need, 0, 1) : 0);
      pol.metals[m] = ore.own[i][m] ? 1 : pol.imports[m];
    }
  });
}

// --- intermarriage ------------------------------------------------------

function likeness(a: Person, b: Person): number {
  let dist = 0;
  for (let d = 0; d < a.prefs.length; d++) for (let o = 0; o < a.prefs[d].length; o++) dist += Math.abs(a.prefs[d][o] - b.prefs[d][o]);
  return 1 - dist / (2 * a.prefs.length);
}

/** Border folk marry across; the bride moves to her husband's settlement with her young children. */
function intermarry(world: World, rng: Rng, locals: (Local | undefined)[]): void {
  const P = world.params;
  if (P.intermarriage <= 0 || P.marriageRange <= 0) return;
  const live = locals.filter((L): L is Local => !!L);
  const wed = new Set<number>();
  const single = (p: Person, lo: number, hi: number) => {
    if (p.spouseId >= 0 || p.role !== 'none' || wed.has(p.id)) return false;
    const age = ageYears(world, p);
    return age >= lo && age < hi;
  };
  for (const X of live) {
    const tx = world.map.tiles[X.s.tile];
    for (const Y of live) {
      if (Y.s.polity === X.s.polity) continue;
      const d = hexDistance(tx, world.map.tiles[Y.s.tile]);
      if (d > P.marriageRange) continue;
      const rel = relation(world, X.s.polity, Y.s.polity);
      const f = rel ? MARRIAGE_STATUS[rel.status] : 0;
      if (!rel || f <= 0) continue;
      // women of X, men of Y
      const women = rng.shuffle(X.people.filter((p) => p.sex === 0 && p.settlement === X.s.id && single(p, ADULT_AGE, 45)));
      if (!women.length) continue;
      const men = rng.shuffle(Y.people.filter((p) => p.sex === 1 && p.settlement === Y.s.id && single(p, ADULT_AGE, 50)));
      const near = 1 - d / (P.marriageRange + 2);
      for (let i = 0; i < Math.min(women.length, men.length); i++) {
        const w = women[i];
        const m = men[i];
        const q = P.intermarriage * f * near * likeness(w, m) * clamp(Math.min(w.reputation, m.reputation), 0.2, 1);
        if (!rng.chance(q)) continue;
        wed.add(w.id);
        wed.add(m.id);
        w.spouseId = m.id;
        m.spouseId = w.id;
        const kids = w.childIds.map((id) => personById(world, id))
          .filter((k): k is Person => !!k && k.settlement === w.settlement && k.motherId === w.id && ageYears(world, k) < ADULT_AGE);
        for (const k of [w, ...kids]) {
          k.settlement = m.settlement;
          k.plots = 0;
          k.lowRepMonths = 0;
        }
        const from = polityOf(world, X.s.polity);
        const to = polityOf(world, Y.s.polity);
        addBio(world, w, `远嫁${to.name}${Y.s.name}的${m.name}`);
        addBio(world, m, `娶${from.name}${X.s.name}的${w.name}为妻`);
        rel.marriagesAcc++;
      }
    }
  }
}

// --- refugees -----------------------------------------------------------

function refuge(world: World, locals: (Local | undefined)[], from: Local): Local | undefined {
  const P = world.params;
  const here = world.map.tiles[from.s.tile];
  let best: Local | undefined;
  let bs = -Infinity;
  for (const L of locals) {
    if (!L || L.s.polity === from.s.polity || L.s.stressMonths > 0) continue;
    if (L.people.length > P.dunbar * 1.5) continue;
    const d = hexDistance(here, world.map.tiles[L.s.tile]);
    if (d > REFUGE_RANGE) continue;
    const rel = relation(world, from.s.polity, L.s.polity);
    if (!rel || rel.status === 'none' || rel.status === 'war') continue;
    const sc = L.stock.food / Math.max(1, L.need) - d * 5;
    if (sc > bs || (sc === bs && best && L.s.id < best.s.id)) {
      bs = sc;
      best = L;
    }
  }
  return best;
}

/** Famine-struck households, and outcasts with nowhere to go at home, seek refuge with a neighbouring people. */
function emigrate(world: World, rng: Rng, locals: (Local | undefined)[]): void {
  const P = world.params;
  const moved = new Set<number>();
  for (const L of locals) {
    if (!L) continue;
    const famine = L.s.stressMonths >= 2 && P.emigration > 0;
    const outcasts = L.people.filter((p) => p.lowRepMonths >= P.exileMonths && p.role === 'none' && p.settlement === L.s.id);
    if (!famine && !outcasts.length) continue;
    const dest = refuge(world, locals, L);
    if (!dest) continue;
    let n = 0;
    const names: string[] = [];
    for (const p of L.people) {
      if (moved.has(p.id) || p.settlement !== L.s.id || p.role !== 'none' || ageYears(world, p) < ADULT_AGE) continue;
      const outcast = p.lowRepMonths >= P.exileMonths;
      if (!(outcast ? rng.chance(0.5) : famine && rng.chance(P.emigration))) continue;
      const sp = personById(world, p.spouseId);
      const family = [p, sp, ...p.childIds.map((id) => personById(world, id))]
        .filter((k): k is Person => !!k && k.settlement === L.s.id && k.role === 'none' && (k === p || k === sp || ageYears(world, k) < ADULT_AGE));
      for (const k of family) {
        moved.add(k.id);
        k.settlement = dest.s.id;
        k.plots = 0;
        k.outsider = true;
        k.reputation = Math.min(k.reputation, P.outsiderRep);
        k.lowRepMonths = 0;
        k.prestige *= 0.3;
        n++;
      }
      addBio(world, p, outcast ? `被${L.s.name}排挤，投奔邻国的${dest.s.name}` : `${L.s.name}闹饥荒，举家逃往邻国的${dest.s.name}`);
      if (names.length < 3) names.push(p.name);
    }
    if (!n) continue;
    const rel = relation(world, L.s.polity, dest.s.polity)!;
    rel.migrantsAcc += n;
    const a = polityOf(world, L.s.polity);
    const b = polityOf(world, dest.s.polity);
    addEvent(world, 'settlement', false, `移民：${L.s.name} → ${dest.s.name}`,
      `${names.join('、')}等 ${n} 人${famine ? `因${L.s.name}缺粮` : '被乡里排挤'}，离开${a.name}，投奔${b.name}的${dest.s.name}，在那里是外来者。`, [], dest.s.id);
  }
}

export function crossBorderMonthly(world: World, rng: Rng): void {
  if (!world.npcs.length) return;
  const locals = buildLocals(world);
  trade(world, locals);
  intermarry(world, rng, locals);
  emigrate(world, rng, locals);
}
