// Tech graph (DESIGN.md §6): fixed nodes, emergent timing. Progress comes from practitioners
// learning by doing and from funded tinkerers, directed by demand; environment gates availability.

import { OCC, NOCC } from './types';
import type { World } from './types';
import type { Rng } from './rng';

export type Domain = 'food' | 'hunt' | 'warmth' | 'tools' | 'storage' | 'admin' | 'transport' | 'war';

export const DOMAIN_NAMES: Record<Domain, string> = {
  food: '食物', hunt: '狩猎', warmth: '保暖', tools: '工具', storage: '储存', admin: '管理', transport: '交通', war: '军事',
};

export type EnvKey = 'grain' | 'animals' | 'clay' | 'copper' | 'tin' | 'river' | 'coast' | 'water';

export const ENV_NAMES: Record<EnvKey, string> = {
  grain: '野生谷物', animals: '可驯化动物', clay: '黏土', copper: '铜矿', tin: '锡矿', river: '河流', coast: '海岸', water: '水域',
};

export interface TechDef {
  id: string;
  name: string;
  desc: string;
  cost: number;
  prereq: string[];
  domain: Domain;
  occs: number[];
  env: EnvKey[];
}

export const TECHS: TechDef[] = [
  { id: 'fire', name: '用火', desc: '烹饪与取暖', cost: 0, prereq: [], domain: 'warmth', occs: [], env: [] },
  { id: 'stone_tools', name: '打制石器', desc: '最基本的工具', cost: 0, prereq: [], domain: 'tools', occs: [], env: [] },
  { id: 'spear_thrower', name: '投矛器', desc: '狩猎产出 +30%', cost: 1500, prereq: [], domain: 'hunt', occs: [OCC.hunt, OCC.tool], env: [] },
  { id: 'fishing', name: '渔具', desc: '解锁捕鱼', cost: 1200, prereq: [], domain: 'food', occs: [OCC.gather, OCC.hunt], env: ['water'] },
  { id: 'bone_needle', name: '骨针缝纫', desc: '衣物产出 +50%', cost: 1400, prereq: [], domain: 'warmth', occs: [OCC.tailor, OCC.hunt], env: [] },
  { id: 'ground_stone', name: '磨制石器', desc: '工具耐用度 +50%', cost: 2500, prereq: [], domain: 'tools', occs: [OCC.tool], env: [] },
  { id: 'bow', name: '弓箭', desc: '狩猎产出再 +40%', cost: 3500, prereq: ['spear_thrower'], domain: 'hunt', occs: [OCC.hunt, OCC.tool], env: [] },
  { id: 'pottery', name: '陶器', desc: '食物腐坏减半', cost: 3000, prereq: ['fire'], domain: 'storage', occs: [OCC.gather, OCC.tool], env: ['clay'] },
  { id: 'weaving', name: '纺织', desc: '衣物不再依赖兽皮', cost: 3000, prereq: ['bone_needle'], domain: 'warmth', occs: [OCC.tailor, OCC.gather], env: [] },
  { id: 'agriculture', name: '农业', desc: '解锁耕作、定居', cost: 9000, prereq: ['ground_stone'], domain: 'food', occs: [OCC.gather], env: ['grain'] },
  { id: 'husbandry', name: '畜牧', desc: '解锁放牧', cost: 8000, prereq: ['spear_thrower'], domain: 'food', occs: [OCC.hunt], env: ['animals'] },
  { id: 'boats', name: '独木舟', desc: '渡河成本大降，捕鱼 +30%', cost: 3500, prereq: ['ground_stone'], domain: 'transport', occs: [OCC.fish, OCC.tool], env: ['water'] },
  { id: 'mudbrick', name: '泥砖房屋', desc: '寒冷伤害 -40%', cost: 4000, prereq: ['agriculture'], domain: 'warmth', occs: [OCC.farm, OCC.tool], env: [] },
  { id: 'tally', name: '计数刻符', desc: '统筹误差 -30%，管理半径 +20%', cost: 4000, prereq: [], domain: 'admin', occs: [OCC.admin, OCC.tinker], env: [] },
  { id: 'calendar', name: '历法', desc: '耕作产出 +20%', cost: 6000, prereq: ['agriculture', 'tally'], domain: 'food', occs: [OCC.farm, OCC.tinker], env: [] },
  { id: 'irrigation', name: '灌溉', desc: '河流地块耕作产出 +50%', cost: 8000, prereq: ['agriculture'], domain: 'food', occs: [OCC.farm], env: ['river'] },
  { id: 'plough', name: '犁', desc: '耕作产出 +40%', cost: 10000, prereq: ['agriculture', 'husbandry'], domain: 'food', occs: [OCC.farm, OCC.herd], env: [] },
  { id: 'wheel', name: '车轮', desc: '平地通行成本 -30%', cost: 9000, prereq: ['ground_stone', 'husbandry'], domain: 'transport', occs: [OCC.tool, OCC.herd], env: [] },
  { id: 'copper', name: '冶铜', desc: '工具加成 +50%', cost: 12000, prereq: ['pottery'], domain: 'tools', occs: [OCC.tool], env: ['copper'] },
  { id: 'writing', name: '文字', desc: '管理半径翻倍，研究 +30%', cost: 15000, prereq: ['tally', 'agriculture'], domain: 'admin', occs: [OCC.admin, OCC.tinker], env: [] },
  { id: 'bronze', name: '青铜', desc: '工具加成再 +50%，耐用度 +50%', cost: 18000, prereq: ['copper'], domain: 'tools', occs: [OCC.tool], env: ['tin'] },
  { id: 'sailing', name: '帆船', desc: '可沿海航行', cost: 14000, prereq: ['boats', 'weaving'], domain: 'transport', occs: [OCC.fish, OCC.tinker], env: ['coast'] },
  // Military techs (DESIGN.md §12.6): demand comes from war and threatening neighbours.
  { id: 'palisade', name: '木栅寨墙', desc: '聚落防守战斗力 +50%', cost: 5000, prereq: ['agriculture'], domain: 'war', occs: [OCC.tool, OCC.farm], env: [] },
  { id: 'bronze_weapons', name: '青铜兵器', desc: '战斗力 +40%', cost: 9000, prereq: ['bronze'], domain: 'war', occs: [OCC.tool, OCC.hunt], env: [] },
  { id: 'chariot', name: '战车', desc: '进攻 +30%，出征半径 +50%', cost: 11000, prereq: ['wheel', 'husbandry'], domain: 'war', occs: [OCC.herd, OCC.tool], env: [] },
  // Reach of the state: settlements beyond it break away or must be held by force (war.ts secession).
  { id: 'relay', name: '驿道', desc: '管理半径 +40%', cost: 12000, prereq: ['wheel', 'tally'], domain: 'admin', occs: [OCC.admin, OCC.herd], env: [] },
  { id: 'bureaucracy', name: '文官制度', desc: '管理半径 +60%，官吏越多管得越远', cost: 22000, prereq: ['writing'], domain: 'admin', occs: [OCC.admin, OCC.tinker], env: [] },
];

export const TECH_INDEX: Record<string, number> = Object.fromEntries(TECHS.map((t, i) => [t.id, i]));

export const ERAS = ['旧石器时代', '新石器时代', '铜石并用时代', '青铜时代'];

export function has(world: World, id: string): boolean {
  return world.tech.known[TECH_INDEX[id]];
}

export function computeEra(world: World): number {
  if (has(world, 'bronze')) return 3;
  if (has(world, 'copper')) return 2;
  if (has(world, 'agriculture') || has(world, 'husbandry')) return 1;
  return 0;
}

export function initTech(rng: Rng): World['tech'] {
  return {
    known: TECHS.map((t) => t.cost === 0),
    progress: TECHS.map(() => 0),
    threshold: TECHS.map(() => rng.range(0.6, 1.4)),
    day: TECHS.map((t) => (t.cost === 0 ? 0 : -1)),
    inventor: TECHS.map(() => -1),
  };
}

export function envFlags(world: World): Record<EnvKey, boolean> {
  const f: Record<EnvKey, boolean> = { grain: false, animals: false, clay: false, copper: false, tin: false, river: false, coast: false, water: false };
  for (const s of world.settlements) {
    if (!s.alive) continue;
    for (const id of s.territory) {
      const t = world.map.tiles[id];
      if (t.grain) f.grain = true;
      if (t.animals) f.animals = true;
      if (t.clay) f.clay = true;
      if (t.copper) f.copper = true;
      if (t.tin) f.tin = true;
      if (t.river) f.river = true;
      if (t.coast) f.coast = true;
      if (t.fishCap > 0) f.water = true;
    }
  }
  // ore bought from neighbours counts once the supply is steady (crossborder.ts)
  const im = world.polity.imports;
  if (im.copper >= 0.3) f.copper = true;
  if (im.tin >= 0.3) f.tin = true;
  return f;
}

export function prereqsMet(world: World, i: number): boolean {
  return TECHS[i].prereq.every((p) => has(world, p));
}

/** Techs whose prerequisites and environment requirements are met but are not yet known. */
export function availableTechs(world: World, env = envFlags(world)): number[] {
  const out: number[] = [];
  for (let i = 0; i < TECHS.length; i++) {
    if (world.tech.known[i]) continue;
    if (!prereqsMet(world, i)) continue;
    if (!TECHS[i].env.every((e) => env[e])) continue;
    out.push(i);
  }
  return out;
}

/** Distribute this month's accumulated learning-by-doing and tinkering into tech progress. */
export function monthlyResearch(world: World, available: number[]): void {
  const P = world.params;
  const acc = world.researchAcc;
  const gains = new Array<number>(TECHS.length).fill(0);
  const w = (i: number) => 0.3 + (world.demand[TECHS[i].domain] ?? 0);

  for (let o = 0; o < NOCC; o++) {
    if (o === OCC.tinker || acc[o] <= 0) continue;
    const linked = available.filter((i) => TECHS[i].occs.includes(o));
    if (!linked.length) continue;
    const total = linked.reduce((s, i) => s + w(i), 0);
    for (const i of linked) gains[i] += (acc[o] * P.lbdRate * w(i)) / total;
  }

  // Funded tinkerers follow demand more sharply than practitioners.
  if (acc[OCC.tinker] > 0 && available.length) {
    const tw = available.map((i) => w(i) * w(i));
    const total = tw.reduce((a, b) => a + b, 0);
    const mult = has(world, 'writing') ? 1.3 : 1;
    available.forEach((i, k) => (gains[i] += (acc[OCC.tinker] * P.researchRate * mult * tw[k]) / total));
  }

  // Spillover to related techs in the same domain (alchemy → chemistry)
  for (const i of available) {
    if (gains[i] <= 0) continue;
    for (const j of available) {
      if (j !== i && TECHS[j].domain === TECHS[i].domain) world.tech.progress[j] += gains[i] * 0.15;
    }
    world.tech.progress[i] += gains[i];
  }
  acc.fill(0);
}
