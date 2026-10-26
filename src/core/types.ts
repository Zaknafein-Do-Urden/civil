import type { Params } from './params';
import type { CultureSetting } from './rules';
import type { RngState } from './rng';

export const DAYS_PER_YEAR = 360;
export const DAYS_PER_MONTH = 30;
export const ADULT_AGE = 16;

// Occupations. Index order is stable: it is used for skill arrays and stats.
export const OCC = {
  gather: 0,
  hunt: 1,
  fish: 2,
  tool: 3,
  tailor: 4,
  farm: 5,
  herd: 6,
  tinker: 7,
  admin: 8,
} as const;
export const NOCC = 9;
export const NO_OCC = -1;
export const OCC_NAMES = ['采集', '狩猎', '捕鱼', '制工具', '缝衣', '耕作', '放牧', '研究', '统筹/官吏'];
export const OCC_COLORS = ['#7cb342', '#c0632b', '#2e86c1', '#8d6e63', '#ab47bc', '#f9a825', '#6d4c41', '#00acc1', '#e53935'];

export type Terrain =
  | 'ocean'
  | 'lake'
  | 'tundra'
  | 'desert'
  | 'grassland'
  | 'plains'
  | 'forest'
  | 'rainforest'
  | 'hills'
  | 'mountains';

export interface Tile {
  id: number;
  col: number;
  row: number;
  elev: number;
  /** Annual mean temperature, °C. */
  temp: number;
  /** Annual rainfall, 0..1. */
  rain: number;
  terrain: Terrain;
  river: boolean;
  coast: boolean;
  plants: number;
  plantsCap: number;
  game: number;
  gameCap: number;
  fish: number;
  fishCap: number;
  fertility: number;
  grain: boolean;
  animals: boolean;
  stone: number;
  clay: boolean;
  copper: boolean;
  tin: boolean;
  /** Owning settlement id, or -1. */
  owner: number;
  /** Cleared farmland plots. */
  plots: number;
  maxPlots: number;
}

export interface WorldMap {
  w: number;
  h: number;
  tiles: Tile[];
}

export interface Person {
  id: number;
  name: string;
  sex: 0 | 1; // 0 = female, 1 = male
  birth: number;
  settlement: number;
  fatherId: number;
  motherId: number;
  spouseId: number;
  /** Adult caring for an orphaned minor. */
  guardianId: number;
  childIds: number[];
  lastBirth: number;
  // Abilities (mean 50, sd 15)
  social: number;
  math: number;
  physical: number;
  // Personality 0..1
  ambition: number;
  integrity: number;
  risk: number;
  conformity: number;
  skills: number[];
  occ: number;
  /** Occupation in childhood household, used by hereditary occupation. */
  parentOcc: number;
  effort: number;
  // Inventory
  food: number;
  tools: number;
  clothes: number;
  plots: number;
  toolCond: number;
  clothesCond: number;
  // Wellbeing
  health: number;
  hunger: number;
  cold: number;
  happiness: number;
  grievance: number;
  prestige: number;
  /** Output value produced over the last month (food units). */
  output: number;
  outputAcc: number;
  /** Preference weights per rule dimension and option, each row sums to 1. */
  prefs: number[][];
  role: 'none' | 'leader' | 'council';
  notable: boolean;
  bio: { day: number; text: string }[];
}

export interface Settlement {
  id: number;
  name: string;
  tile: number;
  territory: number[];
  founded: number;
  alive: boolean;
  /** Communal pool. */
  food: number;
  tools: number;
  clothes: number;
  hides: number;
  /** Prices in food units (exchange). */
  toolPrice: number;
  clothesPrice: number;
  /** Realized daily income per maker from last month's sales (exchange). */
  toolIncome: number;
  clothesIncome: number;
  /** Plots held by the state/chief on this settlement's land. */
  chiefPlots: number;
  /** Travel cost to the capital. */
  distance: number;
  enforcement: number;
  /** Practiced option per dimension (national institution where enforced, local custom otherwise). */
  practiced: number[];
  pop: number;
  stressMonths: number;
}

export interface Polity {
  leaderId: number;
  leaderSince: number;
  councilIds: number[];
  capital: number;
  treasury: { food: number; tools: number; clothes: number };
  legitimacy: number;
  /** Current national institution: option index per dimension. */
  institutions: number[];
  /** Dimensions that have become relevant. */
  active: boolean[];
  dynasty: number;
}

export interface TechState {
  known: boolean[];
  progress: number[];
  /** Fraction of cost at which this world's breakthrough happens (fixed per world). */
  threshold: number[];
  day: number[];
  inventor: number[];
}

export type EventKind =
  | 'leader'
  | 'coup'
  | 'revolution'
  | 'reform'
  | 'tech'
  | 'era'
  | 'famine'
  | 'settlement'
  | 'movement'
  | 'misc';

export interface GameEvent {
  seq: number;
  day: number;
  kind: EventKind;
  major: boolean;
  title: string;
  text: string;
  people: number[];
  settlement: number;
}

export interface YearStats {
  year: number;
  pop: number;
  births: number;
  deaths: number;
  starved: number;
  foodPerCap: number;
  health: number;
  happiness: number;
  grievance: number;
  gini: number;
  legitimacy: number;
  techs: number;
  settlements: number;
  occ: number[];
  /** Power-weighted support for the current institution per dimension. */
  support: number[];
  effort: number;
}

export type Command =
  | { day: number; type: 'movement'; dim: number; opt: number; strength: number }
  | { day: number; type: 'params'; params: Partial<Params> };

export interface NotableRecord {
  id: number;
  name: string;
  birth: number;
  death: number;
  bio: { day: number; text: string }[];
}

export interface World {
  version: 1;
  seed: string;
  day: number;
  rng: RngState;
  params: Params;
  culture: CultureSetting;
  map: WorldMap;
  people: Person[];
  nextId: number;
  settlements: Settlement[];
  polity: Polity;
  tech: TechState;
  /** Demand signal per research domain, refreshed monthly. */
  demand: Record<string, number>;
  /** Research effort accumulated this month per occupation (learning by doing, tinkering). */
  researchAcc: number[];
  /** Monthly accumulators feeding demand signals and diagnostics. */
  monthAcc: { foodProduced: number; foodDecayed: number; coldSum: number; hungerDays: number; personDays: number };
  /** Last month's values of monthAcc, for display and diagnostics. */
  lastMonth: { foodProduced: number; foodDecayed: number; coldSum: number; hungerDays: number; personDays: number };
  era: number;
  stats: YearStats[];
  yearAcc: { births: number; deaths: number; starved: number };
  events: GameEvent[];
  eventSeq: number;
  pending: Command[];
  commandLog: Command[];
  notables: NotableRecord[];
}
