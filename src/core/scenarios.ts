// Scenarios (DESIGN.md §16): a start, goals within a time limit, milestones on the way, ways to lose,
// and shocks that only change the environment. Checked monthly on the whole world. After a defeat the
// player may go on as a sandbox, or take over another polity (takeOver).

import { clamp } from './dmath';
import { addEvent } from './events';
import { allPolities, copyScope, PLAYER } from './nations';
import { TECH_INDEX } from './tech';
import type { Params } from './params';
import type { CultureSetting } from './rules';
import { DAYS_PER_YEAR } from './types';
import type { PolityScope, ScenarioState, World } from './types';

export interface Check {
  id: string;
  name: string;
  /** Current standing, e.g. "人口 412 / 600". */
  progress?(w: World, st: ScenarioState): string;
  test(w: World, st: ScenarioState): boolean;
}

/** An environmental parameter moving linearly from its value at year `from` to `value` at year `to`. */
export interface Shock {
  key: keyof Params;
  from: number;
  to: number;
  value: number;
  desc: string;
}

export interface Scenario {
  id: string;
  name: string;
  desc: string;
  /** Time limit in years (0: none). */
  years: number;
  /** World settings (the map seed is fixed so every play starts on the same land). */
  config: {
    seed?: string;
    population?: number;
    npcCount?: number;
    npcPopulation?: number;
    spread?: number;
    params?: Partial<Params>;
    culture?: CultureSetting;
  };
  /** All must hold to win; with `atEnd`, they are only judged when time runs out. */
  goals: Check[];
  atEnd?: boolean;
  milestones: Check[];
  /** Any of these loses the scenario. */
  fails: Check[];
  shocks: Shock[];
  /** Monthly bookkeeping (e.g. record the population when the cold sets in). */
  track?(w: World, st: ScenarioState): void;
}

// --- helpers --------------------------------------------------------------

const year = (w: World) => w.day / DAYS_PER_YEAR;

function myPop(w: World): number {
  let n = 0;
  for (const p of w.people) if (w.settlements[p.settlement].polity === PLAYER) n++;
  return n;
}

const knows = (w: World, id: string) => w.tech.known[TECH_INDEX[id]];
const techCount = (w: World) => w.tech.known.filter(Boolean).length;

const extinct: Check = {
  id: 'extinct', name: '政权灭亡',
  test: (w) => !w.polity.alive || !w.settlements.some((s) => s.alive && s.polity === PLAYER),
};

/** Settlements held at the start that now belong to someone else. */
function lost(w: World, st: ScenarioState): number {
  return st.initial.filter((id) => w.settlements[id].alive && w.settlements[id].polity !== PLAYER).length;
}

/** Other living polities, and how many of them are ours: paying us tribute. */
function subjects(w: World): [number, number] {
  let others = 0;
  let ours = 0;
  for (const p of allPolities(w)) {
    if (p.id === PLAYER || !p.alive || !w.settlements.some((s) => s.alive && s.polity === p.id)) continue;
    others++;
    const r = w.relations.find((x) => (x.a === PLAYER && x.b === p.id) || (x.b === PLAYER && x.a === p.id));
    if (r?.status === 'tribute' && r.tributary === p.id) ours++;
  }
  return [ours, others];
}

function worldShare(w: World): number {
  return myPop(w) / Math.max(1, w.people.length);
}

// --- the scenarios ----------------------------------------------------------

export const SCENARIOS: Scenario[] = [
  {
    id: 'sandbox', name: '自由沙盒', desc: '没有目标，也没有时限。想怎么玩就怎么玩；只有政权灭亡才算失败。',
    years: 0, config: {}, goals: [], milestones: [], fails: [extinct], shocks: [],
  },
  {
    id: 'tribe', name: '部落时代（入门）',
    desc: '300 人的小部落，周围还有 3 个部落。30 年内让人口翻一番，其间任何一年都不能有超过 5% 的人死于饥寒。熟悉饥荒、开仓和分营。',
    years: 30,
    config: { seed: '曙光2718', population: 300, npcCount: 3, npcPopulation: 300 },
    goals: [{ id: 'double', name: '人口达到 600', progress: (w) => `人口 ${myPop(w)} / 600`, test: (w) => myPop(w) >= 600 }],
    milestones: [
      { id: 'camp', name: '分出第二个营地', test: (w) => w.settlements.filter((s) => s.alive && s.polity === PLAYER).length >= 2 },
      { id: 'pop450', name: '人口达到 450', test: (w) => myPop(w) >= 450 },
      { id: 'invent', name: '第一项新发明', test: (w, st) => techCount(w) > st.marks.techs0 },
      { id: 'farm', name: '学会农业或畜牧', test: (w) => knows(w, 'agriculture') || knows(w, 'husbandry') },
    ],
    fails: [
      extinct,
      {
        id: 'famine', name: '大饥荒（一年内超过 5% 的人死于饥寒）',
        progress: (w) => {
          const s = w.stats[w.stats.length - 1];
          return s ? `去年饥寒死亡 ${((s.starved / Math.max(1, s.pop)) * 100).toFixed(1)}%` : '—';
        },
        test: (w) => {
          const s = w.stats[w.stats.length - 1];
          return !!s && s.pop > 0 && s.starved / s.pop > 0.05;
        },
      },
    ],
    shocks: [],
  },
  {
    id: 'frontier', name: '守住边疆',
    desc: '你的人民已经散布在 15 个聚落里，可管理半径很小，远处的聚落随时可能自立或投靠邻国。50 年内丢失的聚落不能超过 3 个，首都不能陷落。',
    years: 50, atEnd: true,
    config: { seed: '大泽4096', population: 1500, spread: 15, npcCount: 4, npcPopulation: 400, params: { baseReach: 5 } },
    goals: [{ id: 'hold', name: '丢失的聚落不超过 3 个', progress: (w, st) => `已丢失 ${lost(w, st)} / 最多 3`, test: (w, st) => lost(w, st) <= 3 }],
    milestones: [
      { id: 'decade', name: '十年未失寸土', test: (w, st) => year(w) >= 10 && lost(w, st) === 0 },
      { id: 'relay', name: '修通驿道', test: (w) => knows(w, 'relay') },
      { id: 'writing', name: '发明文字', test: (w) => knows(w, 'writing') },
      { id: 'pop2000', name: '人口达到 2000', test: (w) => myPop(w) >= 2000 },
    ],
    fails: [
      extinct,
      { id: 'capital', name: '首都陷落', test: (w, st) => w.settlements[st.initial[0]].polity !== PLAYER },
      { id: 'lost', name: '丢失超过 3 个聚落', test: (w, st) => lost(w, st) > 3 },
    ],
    shocks: [],
  },
  {
    id: 'unify', name: '统一',
    desc: '地图上还有 6 个部落。200 年内让所有还存在的政体都归你所有，或者向你称臣纳贡。打下来之后还得管得住。',
    years: 200,
    config: { seed: '青铜1789', population: 800, npcCount: 6, npcPopulation: 400 },
    goals: [{
      id: 'unify', name: '其余政体全部灭亡或向你称臣',
      progress: (w) => {
        const [ours, others] = subjects(w);
        return `称臣 ${ours} / 现存 ${others} 个政体`;
      },
      test: (w) => {
        const [ours, others] = subjects(w);
        return ours === others;
      },
    }],
    milestones: [
      { id: 'conquest', name: '第一次攻城略地', test: (w) => w.settlements.some((s) => s.alive && s.polity === PLAYER && s.conquered >= 0) },
      { id: 'tributary', name: '第一个朝贡国', test: (w) => subjects(w)[0] >= 1 },
      { id: 'bronze', name: '青铜兵器', test: (w) => knows(w, 'bronze_weapons') },
      { id: 'half', name: '人口占世界一半', test: (w) => worldShare(w) >= 0.5 },
    ],
    fails: [extinct],
    shocks: [],
  },
  {
    id: 'ice', name: '小冰期',
    desc: '前 40 年风调雨顺。从第 40 年起气候逐年变冷，到第 80 年累计降温 2°C，此后不再回暖。到第 100 年，人口不能低于第 40 年；其间一旦跌破第 40 年的一半就失败。',
    years: 100, atEnd: true,
    config: { seed: '云梦3141', population: 1000, npcCount: 3, npcPopulation: 300 },
    goals: [{
      id: 'endure', name: '人口不低于第 40 年',
      progress: (w, st) => (st.marks.pop40 ? `人口 ${myPop(w)} / ${st.marks.pop40}` : `第 40 年时记录基准（现在 ${myPop(w)}）`),
      test: (w, st) => !!st.marks.pop40 && myPop(w) >= st.marks.pop40,
    }],
    milestones: [
      { id: 'pottery', name: '学会制陶（储粮）', test: (w) => knows(w, 'pottery') },
      { id: 'farm', name: '学会农业', test: (w) => knows(w, 'agriculture') },
      { id: 'y60', name: '第 60 年人口不低于基准的九成', test: (w, st) => year(w) >= 60 && !!st.marks.pop40 && myPop(w) >= st.marks.pop40 * 0.9 },
      { id: 'y80', name: '最冷时（第 80 年）人口不低于基准', test: (w, st) => year(w) >= 80 && !!st.marks.pop40 && myPop(w) >= st.marks.pop40 },
    ],
    fails: [
      extinct,
      { id: 'collapse', name: '人口跌破第 40 年的一半', test: (w, st) => !!st.marks.pop40 && myPop(w) < st.marks.pop40 * 0.5 },
    ],
    shocks: [{ key: 'climateShift', from: 40, to: 80, value: -2, desc: '第 40～80 年气温逐年下降，累计 −2°C' }],
    track: (w, st) => {
      if (st.marks.pop40 === undefined && year(w) >= 40) st.marks.pop40 = myPop(w);
    },
  },
];

export function scenarioById(id: string): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
}

export function newScenarioState(id = 'sandbox'): ScenarioState {
  return { id: scenarioById(id).id, status: 'playing', endDay: -1, outcome: '', milestones: {}, marks: {}, initial: [], takeovers: [] };
}

/** Record where the player starts. */
export function startScenario(world: World): void {
  const st = world.scenario;
  const cap = world.polity.capital;
  st.initial = [cap, ...world.settlements.filter((s) => s.alive && s.polity === PLAYER && s.id !== cap).map((s) => s.id)];
  st.marks.pop0 = myPop(world);
  st.marks.techs0 = techCount(world);
  const sc = scenarioById(st.id);
  if (sc.id !== 'sandbox') addEvent(world, 'misc', false, `剧本：${sc.name}`, sc.desc);
}

/** Shocks set their parameter by the year (environment only). */
function applyShocks(world: World, sc: Scenario): void {
  for (const k of sc.shocks) {
    const y = year(world);
    if (y < k.from) continue;
    const base = (world.scenario.marks[`shock:${k.key}`] ??= world.params[k.key] as number);
    const f = clamp((y - k.from) / Math.max(1e-9, k.to - k.from), 0, 1);
    world.params = { ...world.params, [k.key]: base + (k.value - base) * f };
  }
}

function finish(world: World, status: 'won' | 'failed', outcome: string): void {
  const st = world.scenario;
  st.status = status;
  st.endDay = world.day;
  st.outcome = outcome;
  addEvent(world, 'misc', true, status === 'won' ? '剧本完成' : '剧本失败', outcome);
}

/** Monthly, on the whole world. */
export function scenarioMonthly(world: World): void {
  const st = world.scenario;
  const sc = scenarioById(st.id);
  applyShocks(world, sc);
  sc.track?.(world, st);
  if (st.status !== 'playing') return;
  for (const m of sc.milestones) {
    if (st.milestones[m.id] !== undefined || !m.test(world, st)) continue;
    st.milestones[m.id] = world.day;
    addEvent(world, 'misc', true, `里程碑：${m.name}`, `达成第 ${Object.keys(st.milestones).length} / ${sc.milestones.length} 个里程碑。`);
  }
  const f = sc.fails.find((x) => x.test(world, st));
  if (f) return finish(world, 'failed', `失败：${f.name}。`);
  const met = sc.goals.length > 0 && sc.goals.every((g) => g.test(world, st));
  const due = sc.years > 0 && year(world) >= sc.years;
  if (met && (!sc.atEnd || due)) return finish(world, 'won', `在第 ${Math.floor(year(world))} 年达成目标：${sc.goals.map((g) => g.name).join('；')}。`);
  if (due) finish(world, 'failed', `时限已到（${sc.years} 年），目标没有达成：${sc.goals.filter((g) => !g.test(world, st)).map((g) => g.name).join('；')}。`);
}

/**
 * The player becomes the will of polity `pid`: its state moves to slot 0 (the player's) and the old one
 * takes its number, so every id that pointed at either is swapped. The old polity goes on as an NPC.
 */
export function takeOver(world: World, pid: number): void {
  const npc = world.npcs[pid - 1];
  if (pid <= 0 || !npc?.polity.alive) return;
  const old = world.polity.name;
  const tmp = {} as PolityScope;
  copyScope(tmp, world);
  copyScope(world, npc);
  copyScope(npc, tmp);
  world.polity.id = PLAYER;
  npc.polity.id = pid;
  const f = (id: number) => (id === PLAYER ? pid : id === pid ? PLAYER : id);
  for (const s of world.settlements) {
    s.polity = f(s.polity);
    s.origin = f(s.origin);
  }
  for (const p of world.people) p.ethnicity = f(p.ethnicity);
  for (const r of world.relations) {
    const a = f(r.a);
    const b = f(r.b);
    if (r.tributary >= 0) r.tributary = f(r.tributary);
    if (a > b) [r.grudgeA, r.grudgeB] = [r.grudgeB, r.grudgeA];
    r.a = Math.min(a, b);
    r.b = Math.max(a, b);
  }
  for (const war of world.wars) {
    war.attacker = f(war.attacker);
    war.defender = f(war.defender);
  }
  world.decisions = [];
  world.decisionSeen = {};
  world.scenario.takeovers.push(pid);
  addEvent(world, 'misc', true, `接手：${world.polity.name}`, `你不再是${old}的国家意志，从此执掌${world.polity.name}。`);
}
