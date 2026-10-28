import type { Params } from './params';
import type { CultureSetting } from './rules';
import type { RngState } from './rng';
import type { TileHistory } from './tiles';

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
  /** Ethnic group: id of the polity whose founders the father's line descends from. */
  ethnicity: number;
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
  /** Diligence 0..1: how little an hour of work tires this person (heritable). */
  diligence: number;
  skills: number[];
  occ: number;
  /** Occupation in childhood household, used by hereditary occupation. */
  parentOcc: number;
  /** Work intensity while working (sloppiness from grievance), 0..1. */
  effort: number;
  /** Hours worked today (chosen daily, DESIGN.md §4.1). */
  hours: number;
  /** Sum of hours worked this month, and last month's daily average. */
  hoursAcc: number;
  avgHours: number;
  /** Contribution reputation in the home settlement; 1 = does one's share. */
  reputation: number;
  /** Consecutive months with reputation below the exclusion threshold. */
  lowRepMonths: number;
  /** Newcomer who has not yet earned a standing in this settlement. */
  outsider: boolean;
  /** Away on campaign until this day: does no work at home (war.ts). */
  away: number;
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
  /** chief: hereditary headman of a settlement outside the core (control.ts). governor: put in charge of a conquered settlement by the conquerors (war.ts). */
  role: 'none' | 'leader' | 'council' | 'governor' | 'chief';
  notable: boolean;
  /** Political faction id in the home polity, or -1 (factions.ts). */
  faction: number;
  /** Held office as leader, elder, governor or headman, or descends from one through the father. */
  noble: boolean;
  /** Social standing: percentile of wealth and office among the polity's adults, 0..1, updated yearly. */
  rank: number;
  /** The household's rank while this person grew up (father's, else mother's or guardian's), -1 if unknown. */
  originRank: number;
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
  /** Polity this settlement currently belongs to (0 = the player). */
  polity: number;
  /** Polity that founded it; differs from `polity` while a conquered settlement is not yet assimilated. */
  origin: number;
  /** Day it was last conquered, or -1. */
  conquered: number;
  /** Person the conquerors put in charge while it is not assimilated, or -1. */
  governor: number;
  /** Local headman outside the core, or -1 (control.ts). */
  chief: number;
  /** Tax kept by the local ruler for his family: this year so far, and last year. */
  skimAcc: number;
  skimmed: number;
  /** Days left of a running epidemic (0 = none), its severity 0..1 and deaths so far (disease.ts). */
  epidemic: number;
  epiSeverity: number;
  epiDeaths: number;
  epiName: string;
  /** Share of the people immune from the last epidemic, 0..1; fades as new generations are born. */
  immunity: number;
  /** Quality of stone bought from foreign neighbours, 0..1; fades monthly (crossborder.ts). */
  importStone: number;
  /** No tax is collected here before this day (an exemption granted by the state, statecraft.ts). */
  taxFreeUntil: number;
}

export interface Polity {
  /** 0 = the player's polity; NPCs are 1, 2, ... */
  id: number;
  name: string;
  /** Map colour hue, 0..360. */
  hue: number;
  alive: boolean;
  /** War/peace current pushed by events and the player, -1 (pacifist) .. 1 (hawkish); decays yearly. */
  warMood: number;
  leaderId: number;
  leaderSince: number;
  councilIds: number[];
  capital: number;
  treasury: { food: number; tools: number; clothes: number };
  legitimacy: number;
  /** Supply index of ore bought abroad, 0..1 (crossborder.ts). */
  imports: { copper: number; tin: number };
  /** Metal supply, own mines (1) or imports, 0..1: scales the copper and bronze tool bonus. */
  metals: { copper: number; tin: number };
  /** Current national institution: option index per dimension. */
  institutions: number[];
  /** Dimensions that have become relevant. */
  active: boolean[];
  dynasty: number;
  /** Political factions, recomputed yearly (factions.ts). */
  factions: Faction[];
  factionSeq: number;
  /** Per dimension: the option whose reform was last vetoed, or -1 (so a standing veto is reported once). */
  vetoed: number[];
  /** Day of the player's last decree, or -1 (statecraft.ts). */
  lastDecree: number;
}

/** A political faction (party once there are elections): people with shared stances and identities. */
export interface Faction {
  id: number;
  name: string;
  /** What holds it together, e.g. '家族', '民族', '职业', '主张'. */
  basis: string;
  leaderId: number;
  founded: number;
  /** Members (adults). */
  size: number;
  /** Share of the polity's power weight held by its members, 0..1. */
  power: number;
  /** Members' mean preference rows: the faction's platform. */
  prefs: number[][];
  /** Vote share in the last election, 0..1 (0 if none yet). */
  votes: number;
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
  | 'war'
  | 'diplomacy'
  | 'decision'
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
  /** Polity whose internal affairs this is about (-1 or absent: the player's / international). */
  polity?: number;
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
  /** Average daily work hours over the year of working-age people with an occupation, overall and per occupation. */
  hours: number;
  occHours: number[];
  /** People driven out of their settlement for shirking this year. */
  exiled: number;
  outsiders: number;
  /** Intergenerational rank correlation of adults 30–55 with their childhood household (-1 if too few known). */
  mobility: number;
  /** Share of those adults in their father's occupation, and share from the bottom 40% now in the top 40%. */
  occInherit: number;
  upward: number;
  factions: number;
}

export type Command =
  | { day: number; type: 'movement'; dim: number; opt: number; strength: number }
  | { day: number; type: 'params'; params: Partial<Params> }
  | { day: number; type: 'warMood'; value: number }
  /** Answer a pending decision (statecraft.ts). */
  | { day: number; type: 'decide'; id: number; choice: string }
  /** Decrees: change an institution outright; open the granary to a settlement; exempt one from tax. */
  | { day: number; type: 'decree'; dim: number; opt: number }
  | { day: number; type: 'relief'; settlement: number }
  | { day: number; type: 'exempt'; settlement: number; years: number };

export type DecisionKind = 'secession' | 'skim' | 'famine' | 'reform';

/**
 * A moment where the state (the player) must choose: raised by the simulation where it would otherwise
 * decide by itself, and settled by the player's answer or, once the deadline passes, by `auto`.
 */
export interface Decision {
  /** Seq of the event that announced it. */
  id: number;
  kind: DecisionKind;
  day: number;
  due: number;
  title: string;
  text: string;
  settlement: number;
  people: number[];
  options: { id: string; name: string; desc: string }[];
  /** What the state would do left to itself (what NPC polities do). */
  auto: string;
  /** Kind-specific: secession [polity to join or -1]; reform [dim, new option, old option]. */
  data: number[];
}

export interface NotableRecord {
  id: number;
  name: string;
  birth: number;
  death: number;
  bio: { day: number; text: string }[];
}

/** Per-polity simulation state. The player's lives on World's top-level fields, NPCs' in `World.npcs`. */
export interface PolityScope {
  polity: Polity;
  culture: CultureSetting;
  tech: TechState;
  demand: Record<string, number>;
  researchAcc: number[];
  monthAcc: MonthAcc;
  lastMonth: MonthAcc;
  era: number;
  stats: YearStats[];
  yearAcc: YearAcc;
}

export interface YearAcc {
  births: number;
  deaths: number;
  starved: number;
  exiled: number;
  /** Hours worked and days worked per occupation this year (labor.ts). */
  hours: number[];
  workDays: number[];
}

export interface MonthAcc {
  foodProduced: number;
  foodDecayed: number;
  coldSum: number;
  hungerDays: number;
  personDays: number;
}

export type RelationStatus = 'none' | 'contact' | 'peace' | 'alliance' | 'tribute' | 'war';

/** Relations between polities a < b. */
export interface Relation {
  a: number;
  b: number;
  status: RelationStatus;
  since: number;
  /** -1..1 */
  opinion: number;
  /** Ties from real flows of goods and people, 0..1 (crossborder.ts). */
  ties: number;
  /** Last year's bilateral trade (food value, both ways), marriages and migrants; and this year's so far. */
  trade: number;
  tradeAcc: number;
  marriages: number;
  marriagesAcc: number;
  migrants: number;
  migrantsAcc: number;
  /** Last computed border friction, 0..1 (for display). */
  friction: number;
  /** Grudge of a against b, and of b against a. */
  grudgeA: number;
  grudgeB: number;
  /** While status is 'tribute': the polity that pays. */
  tributary: number;
  /** No war is declared before this day without strong cause. */
  truceUntil: number;
}

export interface War {
  id: number;
  attacker: number;
  defender: number;
  start: number;
  /** Main motive of the attacker. */
  goal: 'raid' | 'land' | 'revenge' | 'independence' | 'ally';
  deaths: [number, number];
  loot: [number, number];
  conquests: [number, number];
  /** Monthly actions so far. */
  actions: number;
  /** Day of the last conquest in this war. */
  lastConquest: number;
  /** Day the war ended, or -1 while ongoing. */
  end: number;
  outcome: string;
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
  monthAcc: MonthAcc;
  /** Last month's values of monthAcc, for display and diagnostics. */
  lastMonth: MonthAcc;
  era: number;
  stats: YearStats[];
  yearAcc: YearAcc;
  events: GameEvent[];
  eventSeq: number;
  pending: Command[];
  commandLog: Command[];
  /** Decisions waiting for the player (statecraft.ts). */
  decisions: Decision[];
  /** Last day a decision of each kind was raised or settled, by `kind:subject`. */
  decisionSeen: Record<string, number>;
  /** Settle the player's decisions as the state would by itself (headless runs, comparison runs). */
  autoDecide: boolean;
  notables: NotableRecord[];
  /** Yearly per-tile resource/ownership snapshots, last 100 years (tiles.ts). */
  tileHistory: TileHistory;
  /** NPC polities' state; polity id i lives at npcs[i - 1]. */
  npcs: PolityScope[];
  relations: Relation[];
  wars: War[];
  warSeq: number;
}
