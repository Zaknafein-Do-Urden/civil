// Demand signals, yearly statistics and stagnation diagnostics (DESIGN.md §6.4).

import { clamp } from './dmath';
import { ALLOC, D, DIMS } from './rules';
import { ENV_NAMES, TECHS, availableTechs, envFlags, prereqsMet } from './tech';
import { foodNeed, wealth } from './economy';
import { weightedSupport } from './politics';
import { ADULT_AGE, NOCC, OCC } from './types';
import type { Person, World, YearStats } from './types';

export function updateDemand(world: World, groups: Person[][]): void {
  const lm = world.lastMonth;
  const pd = Math.max(1, lm.personDays);
  const hungerRate = lm.hungerDays / pd;
  let stock = 0;
  let need = 0;
  let toolCond = 0;
  for (const p of world.people) {
    stock += p.food;
    need += foodNeed(world, p);
    toolCond += p.toolCond;
  }
  let game = 0;
  let gameCap = 0;
  let enf = 0;
  let dist = 0;
  let n = 0;
  for (const s of world.settlements) {
    if (!s.alive || !groups[s.id]?.length) continue;
    stock += s.food;
    for (const id of s.territory) {
      game += world.map.tiles[id].game;
      gameCap += world.map.tiles[id].gameCap;
    }
    enf += s.enforcement;
    dist += Math.min(s.distance, 60);
    n++;
  }
  const pop = Math.max(1, world.people.length);
  const stockDays = stock / Math.max(1, need);
  const food = clamp(hungerRate * 6 + (1 - Math.min(1, stockDays / 40)) * 0.4, 0, 1);
  world.demand = {
    food,
    hunt: clamp(food * 0.5 + (1 - game / Math.max(1, gameCap)) * 0.8, 0, 1),
    warmth: clamp((lm.coldSum / pd) * 4, 0, 1),
    tools: clamp(1 - toolCond / pop, 0, 1),
    storage: clamp((lm.foodDecayed / Math.max(1, lm.foodProduced)) * 3, 0, 1),
    admin: clamp((1 - enf / Math.max(1, n)) * (n > 1 ? 1 : 0.2) + (pop / 3000) * 0.3, 0, 1),
    transport: clamp(dist / Math.max(1, n) / 25, 0, 1),
  };
}

export function gini(values: number[]): number {
  const v = values.filter((x) => x >= 0).sort((a, b) => a - b);
  const n = v.length;
  if (n < 2) return 0;
  let cum = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    cum += (i + 1) * v[i];
    sum += v[i];
  }
  if (sum <= 0) return 0;
  return (2 * cum) / (n * sum) - (n + 1) / n;
}

export function yearStats(world: World): YearStats {
  const people = world.people;
  const pop = people.length;
  const occ = new Array<number>(NOCC).fill(0);
  let health = 0;
  let happy = 0;
  let griev = 0;
  let effort = 0;
  let workers = 0;
  const wealths: number[] = [];
  for (const p of people) {
    if (p.occ >= 0) {
      occ[p.occ]++;
      effort += p.effort;
      workers++;
    }
    health += p.health;
    happy += p.happiness;
    griev += p.grievance;
    if (world.day - p.birth >= ADULT_AGE * 360) {
      // in pooled settlements each member has a claim on the common store
      const s = world.settlements[p.settlement];
      const pooled = s.practiced[D.allocation] !== ALLOC.exchange;
      wealths.push(wealth(p, s) + (pooled ? s.food / Math.max(1, s.pop) : 0));
    }
  }
  const sup = weightedSupport(world);
  const lm = world.lastMonth;
  return {
    year: Math.floor(world.day / 360),
    pop,
    births: world.yearAcc.births,
    deaths: world.yearAcc.deaths,
    starved: world.yearAcc.starved,
    foodPerCap: lm.personDays ? lm.foodProduced / lm.personDays : 0,
    health: pop ? health / pop : 0,
    happiness: pop ? happy / pop : 0,
    grievance: pop ? griev / pop : 0,
    gini: gini(wealths),
    legitimacy: world.polity.legitimacy,
    techs: world.tech.known.filter(Boolean).length,
    settlements: world.settlements.filter((s) => s.alive).length,
    occ,
    support: DIMS.map((_, d) => sup[d][world.polity.institutions[d]]),
    effort: workers ? effort / workers : 1,
  };
}

export interface Diagnosis {
  level: 'info' | 'warn' | 'bad';
  text: string;
}

/** Why is this society stuck? Plain-language reasons computed from the current state. */
export function diagnose(world: World): Diagnosis[] {
  const out: Diagnosis[] = [];
  const lm = world.lastMonth;
  const perCap = lm.personDays ? lm.foodProduced / lm.personDays : 0;
  const pop = world.people.length;
  const tinkers = world.people.filter((p) => p.occ === OCC.tinker).length;
  if (perCap < world.params.foodNeedAdult * 1.05) {
    out.push({ level: 'bad', text: `粮食产出仅够糊口（人均每日 ${perCap.toFixed(2)}），几乎没有剩余养活专职研究者和官吏。` });
  } else if (perCap < world.params.foodNeedAdult * 1.3) {
    out.push({ level: 'warn', text: `粮食剩余很少（人均每日 ${perCap.toFixed(2)}），社会分工难以扩大。` });
  }
  if (tinkers === 0) out.push({ level: 'warn', text: '没有人从事专职研究，科技只能靠从业者干中学缓慢积累。' });
  else out.push({ level: 'info', text: `${tinkers} 人从事专职研究（占 ${((tinkers / Math.max(1, pop)) * 100).toFixed(1)}%）。` });

  const env = envFlags(world);
  for (let i = 0; i < TECHS.length; i++) {
    if (world.tech.known[i] || !prereqsMet(world, i)) continue;
    const missing = TECHS[i].env.filter((e) => !env[e]);
    if (missing.length) {
      out.push({ level: 'warn', text: `领地内缺少${missing.map((e) => ENV_NAMES[e]).join('、')}，无法发展「${TECHS[i].name}」。` });
    }
  }
  if (!availableTechs(world, env).length && world.tech.known.some((k) => !k)) {
    out.push({ level: 'bad', text: '当前没有任何可研究的科技：要么缺少前置科技，要么环境中缺少关键资源。' });
  }
  const effort = world.people.filter((p) => p.occ >= 0);
  const avgEffort = effort.reduce((s, p) => s + p.effort, 0) / Math.max(1, effort.length);
  if (avgEffort < 0.8) {
    const bigShare = world.settlements.some((s) => s.alive && s.practiced[D.allocation] === ALLOC.sharing && s.pop > world.params.dunbar);
    const reasons = ['存粮充足时人们会少干活'];
    if (bigShare) reasons.push('部分共享群体超过邓巴数，出现搭便车');
    if (world.settlements.some((s) => s.alive && s.practiced[D.allocation] === ALLOC.command)) reasons.push('统筹体制下产出不归自己，监督不足时会偷懒');
    out.push({ level: 'info', text: `平均努力程度 ${(avgEffort * 100).toFixed(0)}%：${reasons.join('；')}。` });
  }
  if (world.polity.legitimacy < 0.35) out.push({ level: 'bad', text: `政权合法性很低（${(world.polity.legitimacy * 100).toFixed(0)}%），可能发生政变或革命。` });
  const weak = world.settlements.filter((s) => s.alive && s.enforcement < world.params.enforceThreshold);
  if (weak.length) out.push({ level: 'info', text: `${weak.length} 个聚落距离首都太远，制度执行不到，按本地习惯行事。` });
  const last = world.stats[world.stats.length - 1];
  if (last && last.gini > 0.6) out.push({ level: 'warn', text: `贫富差距很大（基尼系数 ${last.gini.toFixed(2)}）。` });
  return out;
}
