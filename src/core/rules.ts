// Rule dimensions (DESIGN.md §2). The player sets the initial cultural leaning per dimension;
// actual institutions emerge from power-weighted preferences and local enforcement.

export type DimId =
  | 'allocation'
  | 'land'
  | 'occupation'
  | 'distribution'
  | 'tax'
  | 'authority'
  | 'succession'
  | 'inheritance'
  | 'speech';

export interface DimDef {
  id: DimId;
  name: string;
  group: string;
  desc: string;
  options: { id: string; name: string; desc: string }[];
}

export const DIMS: DimDef[] = [
  {
    id: 'allocation', name: '资源配置', group: '经济协调',
    desc: '生产什么、谁来生产、产出归谁：习俗、价格还是计划',
    options: [
      { id: 'sharing', name: '共享互惠', desc: '产出入公共储备，按分配原则取用；群体越大搭便车越多' },
      { id: 'exchange', name: '自由交换', desc: '产出归个人，按价格交换，按个人收益选择职业' },
      { id: 'command', name: '首领统筹', desc: '统筹者按感知到的需求指派生产，产出归公' },
    ],
  },
  {
    id: 'land', name: '土地归属', group: '财产',
    desc: '农田归谁所有（出现农业或畜牧后激活）',
    options: [
      { id: 'common', name: '公有', desc: '耕地由耕作者共同使用' },
      { id: 'private', name: '私有', desc: '开垦者拥有土地，可继承，无地者租种需交租' },
      { id: 'chief', name: '归首领', desc: '土地归首领，耕作者向首领纳贡' },
    ],
  },
  {
    id: 'occupation', name: '职业选择', group: '经济协调',
    desc: '一个人从事什么工作由谁决定',
    options: [
      { id: 'free', name: '自由', desc: '个人自行选择' },
      { id: 'assigned', name: '指派', desc: '由首领和统筹者指派' },
      { id: 'hereditary', name: '世袭', desc: '子承父业' },
    ],
  },
  {
    id: 'distribution', name: '分配原则', group: '经济协调',
    desc: '公共储备如何分给个人',
    options: [
      { id: 'equal', name: '平均', desc: '人人一份' },
      { id: 'need', name: '按需', desc: '按各自需要' },
      { id: 'labor', name: '按劳', desc: '按贡献多少' },
      { id: 'rank', name: '按地位', desc: '首领、长老、官吏优先' },
    ],
  },
  {
    id: 'tax', name: '税收', group: '经济协调',
    desc: '个人产出上缴公库的比例',
    options: [
      { id: 'none', name: '无', desc: '不征税' },
      { id: 'light', name: '轻', desc: '10%' },
      { id: 'heavy', name: '重', desc: '30%' },
    ],
  },
  {
    id: 'authority', name: '最高权力', group: '政治权力',
    desc: '重大决策由谁做出，谁的偏好算数',
    options: [
      { id: 'chief', name: '首领一人', desc: '首领意志占主导' },
      { id: 'council', name: '长老议事会', desc: '威望最高的少数人共同决定' },
      { id: 'assembly', name: '全体大会', desc: '所有成年人平等表决' },
    ],
  },
  {
    id: 'succession', name: '领袖产生', group: '政治权力',
    desc: '什么样的人能成为领袖',
    options: [
      { id: 'prestige', name: '威望推举', desc: '威望最高者' },
      { id: 'election', name: '选举', desc: '成年人定期投票' },
      { id: 'hereditary', name: '世袭', desc: '首领长子继承' },
      { id: 'seizure', name: '强者夺取', desc: '最强者取得领导权，可随时被挑战' },
      { id: 'exam', name: '考试选拔', desc: '能力最强者' },
    ],
  },
  {
    id: 'inheritance', name: '继承', group: '财产',
    desc: '死者财产归谁',
    options: [
      { id: 'equal', name: '诸子均分', desc: '子女平分' },
      { id: 'primogeniture', name: '长子继承', desc: '长子独得' },
      { id: 'collective', name: '归公', desc: '归入公共储备' },
    ],
  },
  {
    id: 'speech', name: '言论与信息', group: '社会与信息',
    desc: '信息能否自由流动：影响统筹准确度、不满能否被看见和组织',
    options: [
      { id: 'free', name: '自由', desc: '信息准确，不满公开表达' },
      { id: 'limited', name: '有限', desc: '中间状态' },
      { id: 'controlled', name: '管控', desc: '信息失真，舆论被引导，不满被压抑' },
    ],
  },
];

export const DIM_IDS: DimId[] = DIMS.map((d) => d.id);

// Index constants for hot simulation code. Must match DIMS order above.
export const D = {
  allocation: 0, land: 1, occupation: 2, distribution: 3, tax: 4, authority: 5, succession: 6, inheritance: 7, speech: 8,
} as const;
export const ALLOC = { sharing: 0, exchange: 1, command: 2 } as const;
export const LAND = { common: 0, private: 1, chief: 2 } as const;
export const OCCSEL = { free: 0, assigned: 1, hereditary: 2 } as const;
export const DIST = { equal: 0, need: 1, labor: 2, rank: 3 } as const;
export const TAX_RATES = [0, 0.1, 0.3];
export const AUTH = { chief: 0, council: 1, assembly: 2 } as const;
export const SUCC = { prestige: 0, election: 1, hereditary: 2, seizure: 3, exam: 4 } as const;
export const INH = { equal: 0, primogeniture: 1, collective: 2 } as const;
export const SPEECH = { free: 0, limited: 1, controlled: 2 } as const;

export const DIM_INDEX = Object.fromEntries(DIMS.map((d, i) => [d.id, i])) as Record<DimId, number>;

export function optIndex(dim: DimId, opt: string): number {
  return DIMS[DIM_INDEX[dim]].options.findIndex((o) => o.id === opt);
}

export function optId(dim: DimId, idx: number): string {
  return DIMS[DIM_INDEX[dim]].options[idx].id;
}

export function optName(dim: DimId, idx: number): string {
  return DIMS[DIM_INDEX[dim]].options[idx].name;
}

/** Player's initial culture: an option id per dimension, or null for "not specified". */
export type CultureSetting = Record<DimId, string | null>;

export const UNSPECIFIED: CultureSetting = {
  allocation: null, land: null, occupation: null, distribution: null, tax: null,
  authority: null, succession: null, inheritance: null, speech: null,
};

export const PRESETS: { id: string; name: string; desc: string; culture: CultureSetting }[] = [
  { id: 'none', name: '全部不指定', desc: '完全由小人按自身利益演化', culture: UNSPECIFIED },
  {
    id: 'primitive', name: '原始共产制', desc: '共享、公有、全体大会',
    culture: { allocation: 'sharing', land: 'common', occupation: 'free', distribution: 'need', tax: 'none', authority: 'assembly', succession: 'prestige', inheritance: 'collective', speech: 'free' },
  },
  {
    id: 'chiefdom', name: '部落酋长制', desc: '共享为主，酋长世袭，按地位分配',
    culture: { allocation: 'sharing', land: 'chief', occupation: 'free', distribution: 'rank', tax: 'light', authority: 'chief', succession: 'hereditary', inheritance: 'primogeniture', speech: 'limited' },
  },
  {
    id: 'feudal', name: '封建君主制', desc: '土地归君主，世袭职业，重税',
    culture: { allocation: 'exchange', land: 'chief', occupation: 'hereditary', distribution: 'rank', tax: 'heavy', authority: 'chief', succession: 'hereditary', inheritance: 'primogeniture', speech: 'controlled' },
  },
  {
    id: 'liberal', name: '自由市场民主', desc: '私有、自由交换、选举',
    culture: { allocation: 'exchange', land: 'private', occupation: 'free', distribution: 'labor', tax: 'light', authority: 'assembly', succession: 'election', inheritance: 'equal', speech: 'free' },
  },
  {
    id: 'planned', name: '中央计划一党制', desc: '统筹、指派、议事会、信息管控',
    culture: { allocation: 'command', land: 'common', occupation: 'assigned', distribution: 'labor', tax: 'heavy', authority: 'council', succession: 'exam', inheritance: 'collective', speech: 'controlled' },
  },
  {
    id: 'nordic', name: '北欧式混合', desc: '私有与交换，重税再分配，选举',
    culture: { allocation: 'exchange', land: 'private', occupation: 'free', distribution: 'need', tax: 'heavy', authority: 'assembly', succession: 'election', inheritance: 'equal', speech: 'free' },
  },
];
