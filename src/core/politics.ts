// Prestige, leadership, legitimacy, enforcement, institutional change, coups and revolutions (DESIGN.md §5).

import { clamp } from './dmath';
import { ALLOC, AUTH, D, DIMS, LAND, OCCSEL, SPEECH, SUCC, TAX_RATES, optName } from './rules';
import { addBio, ageYears, personById } from './person';
import { addEvent } from './events';
import { travelCosts } from './map';
import { has } from './tech';
import { foodNeed, settlementAverages, wealth } from './economy';
import type { Rng } from './rng';
import { ADULT_AGE, DAYS_PER_YEAR, OCC } from './types';
import type { Person, Settlement, World } from './types';

const COUNCIL_SIZE = 7;

export function leader(world: World): Person | undefined {
  return personById(world, world.polity.leaderId);
}

function adults(world: World): Person[] {
  return world.people.filter((p) => ageYears(world, p) >= ADULT_AGE);
}

// --- monthly -----------------------------------------------------------

export function updatePrestige(world: World, groups: Person[][]): void {
  for (const s of world.settlements) {
    const people = groups[s.id];
    if (!s.alive || !people?.length) continue;
    const { avgOut, avgWealth: avgW } = settlementAverages(world, s, people);
    for (const p of people) {
      const age = ageYears(world, p);
      if (age < ADULT_AGE) {
        p.prestige *= 0.9;
        continue;
      }
      const role = p.role === 'leader' ? 1.5 : p.role === 'council' ? 0.8 : p.occ === OCC.admin ? 0.4 : 0;
      const target =
        ((p.social - 50) / 50) * 0.6 +
        clamp(p.output / avgOut, 0, 3) * 0.3 +
        clamp(wealth(p, s) / avgW, 0, 3) * 0.25 +
        (Math.min(age, 50) / 50) * 0.4 +
        role +
        (p.notable ? 0.3 : 0);
      p.prestige = p.prestige * 0.9 + target * 0.1;
    }
  }
}

/** Grievance and happiness: hunger, cold, envy, and living under institutions one dislikes. */
export function updateMood(world: World, groups: Person[][]): void {
  const pol = world.polity;
  for (const s of world.settlements) {
    const people = groups[s.id];
    if (!s.alive || !people?.length) continue;
    const avgW = settlementAverages(world, s, people).avgWealth;
    const exchange = s.practiced[D.allocation] === ALLOC.exchange;
    for (const p of people) {
      if (ageYears(world, p) < ADULT_AGE) continue;
      let mismatch = 0;
      let n = 0;
      for (let d = 0; d < DIMS.length; d++) {
        if (!pol.active[d]) continue;
        const row = p.prefs[d];
        const max = Math.max(...row);
        mismatch += 1 - row[s.practiced[d]] / max;
        n++;
      }
      mismatch = n ? mismatch / n : 0;
      const envy = exchange && wealth(p, s) < avgW * 0.3 ? 0.3 : 0;
      const target = clamp(p.hunger * 1.5 + p.cold + envy + mismatch * 0.7, 0, 1);
      p.grievance = p.grievance * 0.85 + target * 0.15;
      p.happiness = clamp(1 - p.grievance * 0.6 - p.hunger * 0.5 - p.cold * 0.3 + clamp(p.prestige, 0, 2) * 0.05, 0, 1);
    }
  }
}

export function updateLegitimacy(world: World): void {
  const pol = world.polity;
  const all = adults(world);
  if (!all.length) return;
  let fit = 0;
  for (const p of all) {
    let f = 0;
    let n = 0;
    for (let d = 0; d < DIMS.length; d++) {
      if (!pol.active[d]) continue;
      // support above what indifference (an even split) would give
      const row = p.prefs[d];
      const even = 1 / row.length;
      f += clamp((row[pol.institutions[d]] - even) / (1 - even), -1, 1);
      n++;
    }
    fit += n ? f / n : 0;
  }
  fit = clamp(fit / all.length, 0, 1);
  const lm = world.lastMonth;
  const hungerRate = lm.personDays ? lm.hungerDays / lm.personDays : 0;
  const security = clamp(1 - hungerRate * 4, 0, 1);
  const l = leader(world);
  // the leader's standing among adults, and graft that people can see
  const lp = l ? all.filter((p) => p.prestige < l.prestige).length / all.length : 0;
  const speech = pol.institutions[D.speech];
  const graft = l ? (1 - l.integrity) * (speech === SPEECH.free ? 1 : speech === SPEECH.limited ? 0.5 : 0.15) : 0;
  const propaganda = speech === SPEECH.controlled ? 0.1 : 0;
  const target = clamp(0.3 * security + 0.4 * fit + 0.2 * lp + 0.1 * (1 - graft) + propaganda, 0, 1);
  pol.legitimacy += (target - pol.legitimacy) * 0.1;
}

/** Leader and council skim the treasury according to their integrity. */
export function corruption(world: World): void {
  const pol = world.polity;
  const takers = [leader(world), ...pol.councilIds.map((id) => personById(world, id))].filter((p): p is Person => !!p);
  for (const p of takers) {
    const share = world.params.corruption * (1 - p.integrity) * (p.role === 'leader' ? 1 : 0.3);
    const take = pol.treasury.food * share;
    pol.treasury.food -= take;
    p.food += take;
  }
}

/** Admins are paid from the treasury; when it runs dry they drift back to production. */
export function payAdmins(world: World, rng: Rng): void {
  const pol = world.polity;
  let payroll = 0;
  for (const p of world.people) {
    if (p.occ !== OCC.admin) continue;
    // in pooled settlements officials eat from the common store like everyone else
    if (world.settlements[p.settlement].practiced[D.allocation] !== ALLOC.exchange) continue;
    const pay = foodNeed(world, p) * 30 * 1.5;
    payroll += pay;
    if (pol.treasury.food >= pay) {
      pol.treasury.food -= pay;
      p.food += pay;
    } else if (rng.chance(0.3)) p.occ = OCC.gather;
  }
  // The rest of the treasury goes back to the settlements' granaries, where the state reaches
  const reserve = Math.max(payroll * 2, world.people.length * 2);
  const surplus = pol.treasury.food - reserve;
  if (surplus > 0) {
    const alive = world.settlements.filter((s) => s.alive && s.pop > 0);
    let wsum = 0;
    for (const s of alive) wsum += s.pop * s.enforcement;
    if (wsum > 0) {
      for (const s of alive) s.food += (surplus * s.pop * s.enforcement) / wsum;
      pol.treasury.food -= surplus;
    }
  }
  // tools/clothes in the treasury flow back to the capital's pool
  const cap = world.settlements[pol.capital];
  if (cap?.alive) {
    cap.tools += pol.treasury.tools;
    cap.clothes += pol.treasury.clothes;
    pol.treasury.tools = 0;
    pol.treasury.clothes = 0;
  }
}

// --- leadership --------------------------------------------------------

function strength(p: Person): number {
  return (p.physical / 50) * (0.5 + p.ambition) * (1 + clamp(p.prestige, 0, 3));
}

function similarity(a: Person, b: Person): number {
  let s = 0;
  for (let d = 0; d < a.prefs.length; d++) {
    const ra = a.prefs[d];
    const rb = b.prefs[d];
    for (let i = 0; i < ra.length; i++) s += ra[i] * rb[i];
  }
  return s / a.prefs.length;
}

/** Choose a leader according to the succession institution. Returns the new leader. */
export function chooseLeader(world: World, rng: Rng, reason: string): Person | undefined {
  const pol = world.polity;
  const old = leader(world);
  const pool = world.people.filter((p) => ageYears(world, p) >= 20);
  if (!pool.length) return undefined;
  const rule = pol.institutions[D.succession];
  let pick: Person | undefined;
  let detail = '';
  const best = (score: (p: Person) => number) => {
    let b = pool[0];
    let bs = -Infinity;
    for (const p of pool) {
      const sc = score(p);
      if (sc > bs) {
        bs = sc;
        b = p;
      }
    }
    return b;
  };
  switch (rule) {
    case SUCC.election: {
      const cands = [...pool].sort((a, b) => b.prestige - a.prestige || a.id - b.id).slice(0, 5);
      const votes = new Map<number, number>(cands.map((c) => [c.id, 0]));
      for (const v of adults(world)) {
        let bc = cands[0];
        let bv = -Infinity;
        for (const c of cands) {
          const score = c.prestige * 0.5 + (c.social - 50) / 50 + similarity(v, c) * 6 + (c.settlement === v.settlement ? 0.5 : 0) + rng.next();
          if (score > bv) {
            bv = score;
            bc = c;
          }
        }
        votes.set(bc.id, (votes.get(bc.id) ?? 0) + 1);
      }
      let top = cands[0];
      for (const c of cands) if ((votes.get(c.id) ?? 0) > (votes.get(top.id) ?? 0)) top = c;
      const total = [...votes.values()].reduce((a, b) => a + b, 0) || 1;
      pick = top;
      detail = `得票 ${Math.round(((votes.get(top.id) ?? 0) / total) * 100)}%`;
      break;
    }
    case SUCC.hereditary: {
      const kids = old ? old.childIds.map((id) => personById(world, id)).filter((k): k is Person => !!k && ageYears(world, k) >= ADULT_AGE) : [];
      // the previous leader may be dead: look up children recorded on the polity's dynasty
      const heir = kids.filter((k) => k.sex === 1).sort((a, b) => a.birth - b.birth)[0] ?? kids.sort((a, b) => a.birth - b.birth)[0];
      if (heir) {
        pick = heir;
        detail = '世袭继位';
      } else {
        pick = best((p) => p.prestige + rng.next() * 0.2);
        if (old || world.day > 0) {
          pol.dynasty++;
          detail = '前任无嗣，新王朝建立';
        } else detail = '开创王朝';
      }
      break;
    }
    case SUCC.seizure:
      pick = best((p) => strength(p) + rng.next() * 0.3);
      detail = '以实力取得领导权';
      break;
    case SUCC.exam:
      pick = best((p) => (ageYears(world, p) <= 60 ? (p.math + p.social) / 2 + rng.next() * 5 : -1));
      detail = '经考核选拔';
      break;
    default:
      pick = best((p) => p.prestige + rng.next() * 0.1);
      detail = '众望所归';
  }
  if (!pick) return undefined;
  setLeader(world, pick, reason, detail);
  return pick;
}

function setLeader(world: World, p: Person, reason: string, detail: string): void {
  const pol = world.polity;
  const old = leader(world);
  if (old && old.id !== p.id) old.role = 'none';
  // the heir for hereditary rule needs the dead leader's children: keep them on the new leader via family
  pol.leaderId = p.id;
  pol.leaderSince = world.day;
  p.role = 'leader';
  p.notable = true;
  embrace(p, pol.institutions);
  const s = world.settlements[p.settlement];
  if (s && pol.capital !== s.id) pol.capital = s.id;
  addBio(world, p, `成为首领（${reason}，${detail}）`);
  addEvent(world, 'leader', false, `新首领：${p.name}`, `${reason}。${p.name}（${detail}）成为首领，驻${s?.name ?? ''}。`, [p.id], p.settlement);
}

/** Pending heir for hereditary succession when the leader has died: children of the dead leader. */
export function ensureLeader(world: World, rng: Rng, deadLeader?: Person): void {
  const pol = world.polity;
  if (personById(world, pol.leaderId)) return;
  if (deadLeader && pol.institutions[D.succession] === SUCC.hereditary) {
    const kids = deadLeader.childIds.map((id) => personById(world, id)).filter((k): k is Person => !!k && ageYears(world, k) >= ADULT_AGE);
    const heir = kids.filter((k) => k.sex === 1).sort((a, b) => a.birth - b.birth)[0] ?? kids.sort((a, b) => a.birth - b.birth)[0];
    if (heir) {
      setLeader(world, heir, `${deadLeader.name}去世`, '世袭继位');
      return;
    }
  }
  chooseLeader(world, rng, deadLeader ? `${deadLeader.name}去世` : '部落推举首领');
}

export function chooseCouncil(world: World): void {
  const pol = world.polity;
  for (const id of pol.councilIds) {
    const p = personById(world, id);
    if (p && p.role === 'council') p.role = 'none';
  }
  const rule = pol.institutions[D.succession];
  const key = (p: Person) =>
    rule === SUCC.exam ? (p.math + p.social) / 2 : rule === SUCC.hereditary ? p.prestige + p.plots * 0.05 : p.prestige;
  const cands = world.people
    .filter((p) => ageYears(world, p) >= 25 && p.role !== 'leader')
    .sort((a, b) => key(b) - key(a) || a.id - b.id)
    .slice(0, COUNCIL_SIZE);
  pol.councilIds = cands.map((p) => p.id);
  for (const p of cands) {
    if (!p.notable) addBio(world, p, '进入长老议事会');
    if (p.role !== 'council') embrace(p, pol.institutions);
    p.role = 'council';
    p.notable = true;
  }
}

/** Those raised to power by an order come to favour the rules that empowered them. */
function embrace(p: Person, institutions: number[]): void {
  for (const d of [D.authority, D.succession]) {
    const row = p.prefs[d];
    for (let o = 0; o < row.length; o++) row[o] = row[o] * 0.5 + (o === institutions[d] ? 0.5 : 0);
  }
}

/** How many officials the institutions require, and who gets the posts. */
export function appointAdmins(world: World): void {
  const pol = world.polity;
  const inst = pol.institutions;
  let duties = 0;
  if (inst[D.allocation] === ALLOC.command) duties += 2;
  if (inst[D.occupation] === OCCSEL.assigned) duties += 1;
  if (TAX_RATES[inst[D.tax]] > 0) duties += 1;
  if (pol.active[D.land] && inst[D.land] === LAND.chief) duties += 1;
  const pop = world.people.length;
  const want = Math.round(pop * 0.006 * duties + (duties ? world.settlements.filter((s) => s.alive).length : 0));
  const current = world.people.filter((p) => p.occ === OCC.admin);
  if (current.length > want) {
    current.sort((a, b) => a.math + a.social - (b.math + b.social) || a.id - b.id);
    for (const p of current.slice(0, current.length - want)) p.occ = OCC.gather;
    return;
  }
  if (current.length === want) return;
  const l = leader(world);
  const rule = inst[D.succession];
  // merit under exam/election, kin and cronies under hereditary/seizure
  const key = (p: Person) => {
    let k = (p.math + p.social) / 2;
    if ((rule === SUCC.hereditary || rule === SUCC.seizure) && l) {
      k = p.prestige * 20 + (p.name[0] === l.name[0] ? 40 : 0) + similarity(p, l) * 50;
    }
    return k;
  };
  const cands = world.people
    .filter((p) => ageYears(world, p) >= 18 && ageYears(world, p) < 65 && p.occ !== OCC.admin && p.role === 'none')
    .sort((a, b) => key(b) - key(a) || a.id - b.id)
    .slice(0, want - current.length);
  for (const p of cands) {
    p.occ = OCC.admin;
    addBio(world, p, '被任命为官吏');
  }
}

export function plannerMath(world: World): number {
  const admins = world.people.filter((p) => p.occ === OCC.admin);
  const l = leader(world);
  if (!admins.length) return l ? l.math * 0.7 : 40;
  let s = 0;
  for (const p of admins) s += p.math;
  return s / admins.length;
}

// --- yearly ------------------------------------------------------------

/** Travel cost to the capital determines how far the national institutions actually reach. */
export function updateEnforcement(world: World): void {
  const pol = world.polity;
  const P = world.params;
  const cap = world.settlements[pol.capital];
  if (!cap?.alive) return;
  const tech = { boats: has(world, 'boats'), wheel: has(world, 'wheel'), sailing: has(world, 'sailing') };
  const costs = travelCosts(world.map, world.map.tiles[cap.tile], tech);
  const admins = world.people.filter((p) => p.occ === OCC.admin).length;
  const l = leader(world);
  const reach =
    P.baseReach *
    (1 + 0.25 * Math.sqrt(admins)) *
    (has(world, 'tally') ? 1.2 : 1) *
    (has(world, 'writing') ? 2 : 1) *
    (l ? 0.7 + (l.social / 100) * 0.6 : 0.7);
  for (const s of world.settlements) {
    if (!s.alive) continue;
    const c = costs[s.tile];
    s.distance = Number.isFinite(c) ? c : 9999;
    s.enforcement = s.id === cap.id ? 1 : clamp(1.25 - s.distance / reach, 0, 1);
  }
}

/** Each settlement practices the national rule where it is enforced, local custom elsewhere. */
export function updatePracticed(world: World, groups: Person[][]): void {
  const pol = world.polity;
  const P = world.params;
  for (const s of world.settlements) {
    const people = groups[s.id];
    if (!s.alive || !people?.length) continue;
    const old = [...s.practiced];
    for (let d = 0; d < DIMS.length; d++) {
      if (s.enforcement >= P.enforceThreshold) {
        s.practiced[d] = pol.institutions[d];
      } else {
        const n = DIMS[d].options.length;
        const mean = new Array<number>(n).fill(0);
        for (const p of people) for (let o = 0; o < n; o++) mean[o] += p.prefs[d][o];
        let best = 0;
        for (let o = 1; o < n; o++) if (mean[o] > mean[best]) best = o;
        // custom changes only when clearly preferred
        if (mean[best] > mean[s.practiced[d]] * 1.15) s.practiced[d] = best;
      }
    }
    if (old[D.land] !== s.practiced[D.land]) landTransfer(world, s, people, s.practiced[D.land]);
  }
}

function landTransfer(world: World, s: Settlement, people: Person[], to: number): void {
  let total = 0;
  for (const id of s.territory) total += world.map.tiles[id].plots;
  if (to === LAND.common) {
    for (const p of people) p.plots = 0;
    s.chiefPlots = 0;
  } else if (to === LAND.chief) {
    for (const p of people) p.plots = 0;
    s.chiefPlots = total;
  } else {
    const farmers = people.filter((p) => p.occ === OCC.farm);
    let owned = 0;
    for (const p of people) owned += p.plots;
    const free = Math.max(0, total - owned);
    s.chiefPlots = 0;
    if (farmers.length) for (const p of farmers) p.plots += free / farmers.length;
  }
}

export function powerWeights(world: World): Map<number, number> {
  const pol = world.polity;
  const auth = pol.institutions[D.authority];
  const w = new Map<number, number>();
  const all = adults(world);
  const council = new Set(pol.councilIds);
  let commoners = 0;
  for (const p of all) if (p.role === 'none') commoners++;
  for (const p of all) {
    let v: number;
    if (auth === AUTH.chief) {
      v = p.id === pol.leaderId ? 0.6 : council.has(p.id) ? 0.25 / COUNCIL_SIZE : 0.15 / Math.max(1, commoners);
    } else if (auth === AUTH.council) {
      v = p.id === pol.leaderId || council.has(p.id) ? 0.7 / (COUNCIL_SIZE + 1) : 0.3 / Math.max(1, commoners);
    } else {
      v = 1 / all.length;
    }
    w.set(p.id, v);
  }
  return w;
}

/** Power-weighted support for each option of each dimension. */
export function weightedSupport(world: World): number[][] {
  const w = powerWeights(world);
  const sup = DIMS.map((d) => new Array<number>(d.options.length).fill(0));
  let total = 0;
  for (const p of world.people) {
    const v = w.get(p.id);
    if (!v) continue;
    total += v;
    for (let d = 0; d < DIMS.length; d++) for (let o = 0; o < sup[d].length; o++) sup[d][o] += v * p.prefs[d][o];
  }
  if (total > 0) for (const row of sup) for (let o = 0; o < row.length; o++) row[o] /= total;
  return sup;
}

export function popularSupport(world: World, filter?: (p: Person) => boolean): number[][] {
  const sup = DIMS.map((d) => new Array<number>(d.options.length).fill(0));
  let n = 0;
  for (const p of adults(world)) {
    if (filter && !filter(p)) continue;
    n++;
    for (let d = 0; d < DIMS.length; d++) for (let o = 0; o < sup[d].length; o++) sup[d][o] += p.prefs[d][o];
  }
  if (n) for (const row of sup) for (let o = 0; o < row.length; o++) row[o] /= n;
  return sup;
}

/** Peaceful reform when those holding power clearly prefer another option. */
export function institutionalChange(world: World): void {
  const pol = world.polity;
  const sup = weightedSupport(world);
  for (let d = 0; d < DIMS.length; d++) {
    if (!pol.active[d]) continue;
    const row = sup[d];
    let best = 0;
    for (let o = 1; o < row.length; o++) if (row[o] > row[best]) best = o;
    const cur = pol.institutions[d];
    if (best !== cur && row[best] - row[cur] > world.params.reformMargin) {
      const how = pol.institutions[D.authority] === AUTH.chief ? '首领下令' : pol.institutions[D.authority] === AUTH.council ? '议事会决定' : '大会表决';
      pol.institutions[d] = best;
      addEvent(world, 'reform', true, `改革：${DIMS[d].name}`,
        `${how}，${DIMS[d].name}由「${optName(DIMS[d].id, cur)}」改为「${optName(DIMS[d].id, best)}」（加权支持 ${pct(row[best])} 对 ${pct(row[cur])}）。`,
        [pol.leaderId]);
    }
  }
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

/** Revolutions when grievance is high and legitimacy low; coups by ambitious strongmen. */
export function unrest(world: World, rng: Rng): void {
  const pol = world.polity;
  const P = world.params;
  const all = adults(world);
  if (all.length < 10) return;
  let g = 0;
  for (const p of all) g += p.grievance;
  g /= all.length;
  const controlled = pol.institutions[D.speech] === SPEECH.controlled;
  const free = pol.institutions[D.speech] === SPEECH.free;
  const threshold = P.revoltThreshold + (controlled ? 0.1 : 0) - (free ? 0.05 : 0);

  if (g > threshold && pol.legitimacy < 0.35 && rng.chance(0.3)) {
    revolution(world, rng, all);
    return;
  }

  const l = leader(world);
  if (!l) return;
  const seizure = pol.institutions[D.succession] === SUCC.seizure;
  if (pol.legitimacy < 0.4 || seizure) {
    let challenger: Person | undefined;
    let cs = 0;
    for (const p of all) {
      if (p.id === l.id) continue;
      const sc = p.ambition * (1 - p.integrity) * (1 + clamp(p.prestige, 0, 3));
      if (sc > cs) {
        cs = sc;
        challenger = p;
      }
    }
    if (!challenger || challenger.ambition < 0.65 || (!seizure && challenger.integrity > 0.45)) return;
    if (!rng.chance(seizure ? 0.25 : 0.3)) return;
    const atk = strength(challenger) * (1 + (1 - pol.legitimacy));
    const def = strength(l) * (1 + pol.legitimacy * 2);
    if (atk > def * rng.range(0.7, 1.3)) {
      const oldName = l.name;
      addBio(world, l, `被 ${challenger.name} 推翻`);
      l.role = 'none';
      l.grievance = 1;
      setLeader(world, challenger, `${challenger.name} 发动政变推翻 ${oldName}`, seizure ? '以实力夺权' : '政变上台');
      pol.legitimacy = clamp(pol.legitimacy * 0.6, 0, 1);
      addEvent(world, 'coup', true, `政变：${challenger.name} 夺权`,
        `${challenger.name}（野心 ${pct(challenger.ambition)}，诚信 ${pct(challenger.integrity)}）推翻了 ${oldName}。当前合法性 ${pct(pol.legitimacy)}。`,
        [challenger.id, l.id]);
    } else {
      addBio(world, challenger, `挑战首领 ${l.name} 失败`);
      challenger.prestige *= 0.5;
      addEvent(world, 'coup', false, `政变未遂`, `${challenger.name} 试图推翻 ${l.name}，失败了。`, [challenger.id, l.id]);
    }
  }
}

function revolution(world: World, rng: Rng, all: Person[]): void {
  const pol = world.polity;
  const rebels = all.filter((p) => p.grievance > 0.5);
  const loyal = all.filter((p) => p.grievance < 0.3 || p.role !== 'none' || p.occ === OCC.admin);
  const force = (ps: Person[], bonus: (p: Person) => number) =>
    ps.reduce((s, p) => s + (p.physical / 50) * (0.5 + p.risk) * bonus(p), 0);
  const r = force(rebels, () => 1);
  const l = force(loyal, (p) => (p.occ === OCC.admin || p.role !== 'none' ? 2 : 1));
  const old = leader(world);
  const killedRate = rng.range(0.02, 0.06);
  const killed: Person[] = [];
  for (const p of [...rebels, ...loyal]) if (rng.chance(killedRate)) killed.push(p);
  for (const p of killed) p.health = -1; // dies in the next demography pass
  if (r > l * rng.range(0.8, 1.2)) {
    const sup = popularSupport(world, (p) => p.grievance > 0.5);
    const changes: string[] = [];
    for (let d = 0; d < DIMS.length; d++) {
      if (!pol.active[d]) continue;
      let best = 0;
      for (let o = 1; o < sup[d].length; o++) if (sup[d][o] > sup[d][best]) best = o;
      if (best !== pol.institutions[d]) {
        changes.push(`${DIMS[d].name}→${optName(DIMS[d].id, best)}`);
        pol.institutions[d] = best;
      }
    }
    let head = rebels[0];
    for (const p of rebels) if (p.prestige * p.ambition > head.prestige * head.ambition) head = p;
    if (old) {
      old.role = 'none';
      addBio(world, old, '在革命中被推翻');
    }
    for (const id of pol.councilIds) {
      const c = personById(world, id);
      if (c) c.role = 'none';
    }
    pol.councilIds = [];
    setLeader(world, head, '革命胜利', '革命领袖');
    pol.legitimacy = 0.6;
    for (const p of rebels) p.grievance *= 0.4;
    addEvent(world, 'revolution', true, '革命成功',
      `${rebels.length} 名不满者起义，推翻了${old ? old.name : '旧政权'}，${head.name} 成为新首领。约 ${killed.length} 人死于冲突。制度变化：${changes.join('，') || '无'}。`,
      [head.id, ...(old ? [old.id] : [])]);
  } else {
    pol.legitimacy = clamp(pol.legitimacy - 0.1, 0, 1);
    for (const p of rebels) p.grievance = clamp(p.grievance + 0.1, 0, 1);
    addEvent(world, 'revolution', true, '起义被镇压',
      `${rebels.length} 名不满者起义，被忠于${old ? old.name : '政权'}的力量镇压。约 ${killed.length} 人死于冲突。`,
      old ? [old.id] : []);
  }
}

export function maybeElection(world: World, rng: Rng): void {
  const pol = world.polity;
  if (pol.institutions[D.succession] !== SUCC.election) return;
  if (world.day - pol.leaderSince < world.params.termYears * DAYS_PER_YEAR) return;
  chooseLeader(world, rng, '任期届满举行选举');
}

/** The land dimension only matters once people farm or herd. */
export function updateActive(world: World): void {
  const pol = world.polity;
  const was = pol.active[D.land];
  pol.active[D.land] = has(world, 'agriculture') || has(world, 'husbandry');
  if (!was && pol.active[D.land]) {
    addEvent(world, 'misc', false, '土地问题浮现', '人们开始耕种或放牧，土地归谁所有成为需要回答的问题。');
  }
}

/** A player-initiated movement: idealists adopt the idea; others react according to interest. */
export function startMovement(world: World, rng: Rng, dim: number, opt: number, strength: number): void {
  const all = adults(world);
  const ranked = all
    .map((p) => [(1 - p.conformity) * (0.5 + p.risk) + rng.next() * 0.3, p] as const)
    .sort((a, b) => b[0] - a[0] || a[1].id - b[1].id);
  const n = Math.floor(ranked.length * strength);
  for (let i = 0; i < ranked.length; i++) {
    const row = ranked[i][1].prefs[dim];
    const k = i < n ? 0.7 : 0.1;
    for (let o = 0; o < row.length; o++) row[o] = row[o] * (1 - k) + (o === opt ? k : 0);
  }
  const d = DIMS[dim];
  addEvent(world, 'movement', true, `思潮兴起：${d.name}应当「${d.options[opt].name}」`,
    `${n} 名理想主义者开始鼓吹${d.name}改为「${d.options[opt].name}」。其他人将按各自利益决定支持还是反对。`);
}

