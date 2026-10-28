// The player as the will of the state (DESIGN.md §14): answering decision cards, and decrees.
// Decision cards are raised where the simulation decides (decisions.ts); here they are settled.
// Decrees act at once but have a price: legitimacy, resentment, the treasury.

import { clamp } from './dmath';
import { DIMS, D, SPEECH, optName } from './rules';
import { addBio, ageYears, personById } from './person';
import { addEvent } from './events';
import { hexDistance } from './map';
import { inPolity, PLAYER } from './nations';
import { probeOdds } from './control';
import { asked, playerDecides, propose, seenKey, subjectOf } from './decisions';
import { adults, factionCamps, resent, resolveReform, suppressCost, weightedSupport } from './politics';
import { checkingBody, factionIndex, voteRow } from './factions';
import { appointGovernor, resolveSecession } from './war';
import type { Rng } from './rng';
import { ADULT_AGE, DAYS_PER_YEAR } from './types';
import type { Decision, Settlement, World } from './types';

// --- decision cards ------------------------------------------------------

/** Settle a decision with the player's choice (or its default once overdue). Runs on the whole world. */
export function resolveDecision(world: World, rng: Rng, id: number, choice: string, late = false): void {
  const i = world.decisions.findIndex((d) => d.id === id);
  if (i < 0) return;
  const d = world.decisions.splice(i, 1)[0];
  if (!d.options.some((o) => o.id === choice)) choice = d.auto;
  world.decisionSeen[seenKey(d.kind, subjectOf(d))] = world.day;
  if (late) {
    const name = d.options.find((o) => o.id === choice)!.name;
    addEvent(world, 'decision', false, `逾期未决：${d.title}`, `过了期限没有裁决，按惯例「${name}」处理。`, [], d.settlement);
  }
  if (d.kind === 'secession') resolveSecession(world, rng, d, choice);
  else if (d.kind === 'reform') inPolity(world, PLAYER, (v) => resolveReform(v, d, choice));
  else if (d.kind === 'skim') inPolity(world, PLAYER, (v) => resolveSkim(v, rng, d, choice));
  else if (d.kind === 'famine') inPolity(world, PLAYER, (v) => resolveFamine(v, d, choice));
}

/** Decisions left unanswered past their deadline are settled as the state would by itself. */
export function settleOverdue(world: World, rng: Rng): void {
  if (!world.decisions.length) return;
  for (const d of world.decisions.filter((x) => world.day >= x.due)) resolveDecision(world, rng, d.id, d.auto, true);
}

function mine(world: World, id: number): Settlement | undefined {
  const s = world.settlements[id];
  return s?.alive && s.polity === world.polity.id ? s : undefined;
}

function localAdults(world: World, s: Settlement) {
  return world.people.filter((p) => p.settlement === s.id && ageYears(world, p) >= ADULT_AGE);
}

// --- a headman skimming the taxes (raised in control.ts) -----------------

function resolveSkim(world: World, rng: Rng, d: Decision, choice: string): void {
  const s = mine(world, d.settlement);
  const c = s && personById(world, s.chief);
  if (!s || !c || c.role !== 'chief' || c.settlement !== s.id) return;
  const pol = world.polity;
  const locals = localAdults(world, s);
  if (choice === 'probe') {
    if (rng.chance(probeOdds(world, s))) {
      const seized = c.food;
      pol.treasury.food += c.food;
      pol.treasury.tools += c.tools;
      pol.treasury.clothes += c.clothes;
      c.food = 0;
      c.tools = 0;
      c.clothes = 0;
      c.role = 'none';
      c.grievance = 1;
      c.prestige *= 0.5;
      s.chief = -1;
      addBio(world, c, `因中饱私囊被${pol.name}查办，家产充公`);
      for (const p of locals) p.grievance = clamp(p.grievance + 0.03, 0, 1);
      addEvent(world, 'misc', false, `查办：${c.name}`, `${s.name}头人${c.name}被查办，约 ${Math.round(seized)} 食物充入国库，头人之位另选他人。`, [c.id], s.id);
    } else {
      pol.legitimacy = clamp(pol.legitimacy - 0.05, 0, 1);
      for (const p of locals) p.grievance = clamp(p.grievance + 0.1, 0, 1);
      addBio(world, c, `拒不服从${pol.name}的查办`);
      addEvent(world, 'misc', true, `查办失败：${c.name}抗命`, `${pol.name}派去${s.name}的人被挡了回来。头人${c.name}拒不认罪，当地人站在他一边，首领威信受损。`, [c.id], s.id);
    }
    return;
  }
  if (choice === 'governor') {
    const g = appointGovernor(world, s, true);
    if (!g) {
      addEvent(world, 'misc', false, `无人可派：${s.name}`, `附近的核心聚落找不到合适的人去镇守${s.name}，${c.name}照旧当他的头人。`, [c.id], s.id);
      return;
    }
    c.role = 'none';
    s.chief = -1;
    s.enforcement = Math.max(s.enforcement, 0.75);
    addBio(world, c, `被${g.name}取代，不再任头人`);
    for (const p of locals) p.grievance = clamp(p.grievance + 0.05, 0, 1);
    addEvent(world, 'misc', false, `派镇守：${s.name}`, `${g.name}带着家眷来到${s.name}，取代头人${c.name}主事，此后当地赋税全数上交。`, [g.id, c.id], s.id);
    return;
  }
  if (pol.institutions[D.speech] !== SPEECH.controlled) pol.legitimacy = clamp(pol.legitimacy - 0.02, 0, 1);
}

// --- famine (raised here, monthly) --------------------------------------

const RELIEF_DAYS = 60;
const NEIGHBOUR_RANGE = 4;
const NEIGHBOUR_SHARE = 0.2;

/** What the treasury and the capital's granary can send to `s`: [amount, days of food it means there]. */
function granary(world: World, s: Settlement): [number, number] {
  const pol = world.polity;
  const need = s.pop * world.params.foodNeedAdult;
  const cap = world.settlements[pol.capital];
  const avail = pol.treasury.food + (cap?.alive && cap !== s ? cap.food * 0.5 : 0);
  const amount = Math.min(need * RELIEF_DAYS, avail);
  return [amount, amount / Math.max(1, need)];
}

function helpers(world: World, s: Settlement): Settlement[] {
  const here = world.map.tiles[s.tile];
  return world.settlements.filter((o) => o.alive && o.id !== s.id && o.stressMonths === 0 && o.food > 0 &&
    hexDistance(here, world.map.tiles[o.tile]) <= NEIGHBOUR_RANGE);
}

/** Monthly, on the player's view: the hungriest settlement asks the state for help. */
export function famineAppeal(world: World): void {
  if (!playerDecides(world, world.polity.id)) return;
  let worst: Settlement | undefined;
  for (const s of world.settlements) {
    if (!s.alive || s.stressMonths < 2 || s.pop < 20) continue;
    if (asked(world, 'famine', s.id, DAYS_PER_YEAR)) continue;
    if (!worst || s.stressMonths * s.pop > worst.stressMonths * worst.pop) worst = s;
  }
  if (!worst) return;
  const s = worst;
  const [amount, days] = granary(world, s);
  const near = helpers(world, s);
  let pooled = 0;
  for (const o of near) pooled += o.food * NEIGHBOUR_SHARE;
  const need = s.pop * world.params.foodNeedAdult;
  propose(world, {
    kind: 'famine', settlement: s.id, people: [], auto: 'none', data: [],
    title: `${s.name}闹饥荒`,
    text: `${s.name}（${s.pop} 人）已经连续 ${s.stressMonths} 个月有人吃不饱，当地粮仓只剩约 ${Math.round(s.food / Math.max(1, need))} 天的口粮。`,
    options: [
      {
        id: 'granary', name: '开仓赈济',
        desc: amount < need * 5
          ? `国库和都城粮仓几乎空了，只能调出约 ${Math.round(amount)} 食物（够吃 ${Math.round(days)} 天）。`
          : `从国库和都城粮仓调约 ${Math.round(amount)} 食物（够当地吃 ${Math.round(days)} 天）。合法性上升，当地不满下降；都城存粮减少。`,
      },
      {
        id: 'neighbors', name: '令邻近聚落接济',
        desc: near.length
          ? `令附近 ${near.length} 个不缺粮的聚落各拿出两成存粮，约 ${Math.round(pooled)} 食物（够吃 ${Math.round(pooled / Math.max(1, need))} 天）。出粮的人有怨言。`
          : '附近没有不缺粮的聚落可以接济。',
      },
      { id: 'none', name: '不管', desc: '让他们自己想办法：可能有人饿死，有人逃荒、分出去另建营地或投奔邻国。' },
    ],
  });
}

function resolveFamine(world: World, d: Decision, choice: string): void {
  const s = mine(world, d.settlement);
  if (!s) return;
  if (choice === 'granary') relief(world, s, false);
  else if (choice === 'neighbors') {
    const near = helpers(world, s);
    let sent = 0;
    for (const o of near) {
      const x = o.food * NEIGHBOUR_SHARE;
      o.food -= x;
      sent += x;
      for (const p of localAdults(world, o)) p.grievance = clamp(p.grievance + 0.03, 0, 1);
    }
    s.food += sent;
    eased(world, s, sent);
    addEvent(world, 'famine', false, `接济：${s.name}`, `附近 ${near.length} 个聚落凑出约 ${Math.round(sent)} 食物送到${s.name}。`, [], s.id);
  }
}

/** Food reaching a hungry settlement in time wins the state some gratitude. */
function eased(world: World, s: Settlement, amount: number): void {
  if (s.stressMonths < 1) return;
  const frac = clamp(amount / Math.max(1, s.pop * world.params.foodNeedAdult * RELIEF_DAYS), 0, 1);
  world.polity.legitimacy = clamp(world.polity.legitimacy + 0.03 * frac, 0, 1);
  for (const p of localAdults(world, s)) p.grievance *= 1 - 0.15 * frac;
}

// --- decrees -------------------------------------------------------------

/** Open the treasury and the capital's granary to `s`. Runs on the player's view. */
export function relief(world: World, s: Settlement | undefined, decree: boolean): void {
  s = s && mine(world, s.id);
  if (!s) return;
  const pol = world.polity;
  let [amount] = granary(world, s);
  const sent = amount;
  if (sent < 1) {
    addEvent(world, 'famine', false, `无粮可调：${s.name}`, `国库和都城粮仓都空了，没有粮食可以送往${s.name}。`, [], s.id);
    return;
  }
  const fromTreasury = Math.min(amount, pol.treasury.food);
  pol.treasury.food -= fromTreasury;
  amount -= fromTreasury;
  if (amount > 0) world.settlements[pol.capital].food -= amount;
  s.food += sent;
  eased(world, s, sent);
  addEvent(world, 'famine', false, `开仓：${s.name}`,
    `${decree ? '奉令' : ''}从国库和都城粮仓调出约 ${Math.round(sent)} 食物送往${s.name}。${s.stressMonths > 0 ? '' : '当地并不缺粮，这批粮食没有换来多少感激。'}`, [], s.id);
}

/** Exempt `s` from tax for some years. Runs on the player's view. */
export function exempt(world: World, s: Settlement | undefined, years: number): void {
  s = s && mine(world, s.id);
  if (!s || s.id === world.polity.capital) return;
  years = clamp(Math.round(years), 1, 10);
  s.taxFreeUntil = world.day + years * DAYS_PER_YEAR;
  for (const p of localAdults(world, s)) p.grievance *= 0.85;
  addEvent(world, 'misc', false, `免税：${s.name}`, `${world.polity.name}免去${s.name} ${years} 年赋税。`, [], s.id);
}

/**
 * Change an institution by decree, over the heads of those in power. A checking body may block it; when it
 * goes through, legitimacy pays for the opposition among the powerful, and those who liked the old way resent it.
 * Nothing stops the powerful from pushing it back later (a reform card).
 */
export function decree(world: World, dim: number, opt: number): void {
  const pol = world.polity;
  const def = DIMS[dim];
  if (!def || !pol.active[dim] || pol.institutions[dim] === opt || !def.options[opt]) return;
  if (pol.lastDecree >= 0 && world.day - pol.lastDecree < world.params.decreeCooldown) return;
  pol.lastDecree = world.day;
  const cur = pol.institutions[dim];
  const change = `${def.name}由「${optName(def.id, cur)}」改为「${optName(def.id, opt)}」`;
  const camps = factionCamps(world, dim, opt, cur);
  const body = checkingBody(world);
  let vote = '';
  if (body && body.members.length) {
    const fx = factionIndex(world);
    let yes = 0;
    for (const p of body.members) {
      const r = voteRow(world, fx, p, dim);
      if (r[opt] > r[cur]) yes++;
    }
    const no = body.members.length - yes;
    if (yes <= no) {
      pol.legitimacy = clamp(pol.legitimacy - 0.03, 0, 1);
      addEvent(world, 'reform', true, `法令被否决：${def.name}`,
        `法令要把${change}，${body.name}以 ${yes} 对 ${no} 否决，法令作废，首领威信受损。${camps}`, [pol.leaderId]);
      return;
    }
    vote = `${body.name}以 ${yes} 对 ${no} 通过，`;
  }
  const sup = weightedSupport(world)[dim];
  const cost = suppressCost(world, sup[cur] - sup[opt]);
  pol.legitimacy = clamp(pol.legitimacy - cost, 0, 1);
  resent(world, dim, cur, opt);
  pol.institutions[dim] = opt;
  pol.vetoed[dim] = -1;
  const all = adults(world).length;
  addEvent(world, 'reform', true, `法令：${def.name}`,
    `${vote}${change}（掌权者加权支持 ${Math.round(sup[opt] * 100)}% 对 ${Math.round(sup[cur] * 100)}%）。合法性 −${Math.round(cost * 100)}%，` +
    `${all} 名成年人中偏爱旧制的人不满上升。${camps}`, [pol.leaderId]);
}
