import { DIMS, optIndex } from './rules';
import type { CultureSetting } from './rules';
import type { Rng } from './rng';
import { clamp, ln } from './dmath';
import { ADULT_AGE, DAYS_PER_YEAR, NOCC, NO_OCC } from './types';
import type { Person, World } from './types';

const SURNAMES = '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏窦章云苏潘葛范彭郎鲁韦马苗凤方俞任袁柳鲍史唐费薛雷贺倪汤殷罗毕郝安常乐于傅齐康伍余顾孟黄穆萧尹';
const MALE = '山石岩峰川河海林森木松柏风雷虎豹熊鹰狼刚勇猛武强壮力坚岳岭冈泽江涛';
const FEMALE = '花草兰芳菊梅莲荷月星云霞雪露珠玉琴瑶灵秀美婉柔清雅静慧桃杏';

export function randomName(rng: Rng, sex: 0 | 1, surname?: string): string {
  const s = surname ?? SURNAMES[rng.int(SURNAMES.length)];
  const pool = sex ? MALE : FEMALE;
  const given = rng.chance(0.5) ? pool[rng.int(pool.length)] : pool[rng.int(pool.length)] + pool[rng.int(pool.length)];
  return s + given;
}

export function surnameOf(p: Person): string {
  return p.name[0];
}

export function ageYears(world: World, p: Person): number {
  return (world.day - p.birth) / DAYS_PER_YEAR;
}

export function isAdult(world: World, p: Person): boolean {
  return world.day - p.birth >= ADULT_AGE * DAYS_PER_YEAR;
}

function ability(rng: Rng): number {
  return clamp(50 + rng.normal() * 15, 1, 99);
}

function trait(rng: Rng): number {
  return clamp(0.5 + rng.normal() * 0.2, 0, 1);
}

/** Initial preference rows from the player's culture setting. */
export function initPrefs(rng: Rng, culture: CultureSetting): number[][] {
  return DIMS.map((d) => {
    const n = d.options.length;
    const chosen = culture[d.id];
    const row = new Array<number>(n);
    if (chosen) {
      const ci = optIndex(d.id, chosen);
      for (let i = 0; i < n; i++) row[i] = i === ci ? 0.55 + rng.next() * 0.25 : rng.next() * 0.2;
    } else {
      for (let i = 0; i < n; i++) row[i] = 0.7 + rng.next() * 0.6;
    }
    return normalize(row);
  });
}

export function normalize(row: number[]): number[] {
  let s = 0;
  for (let i = 0; i < row.length; i++) {
    if (row[i] < 0.01) row[i] = 0.01;
    s += row[i];
  }
  for (let i = 0; i < row.length; i++) row[i] /= s;
  return row;
}

function blank(world: World, rng: Rng, sex: 0 | 1, birth: number, settlement: number): Person {
  return {
    id: world.nextId++,
    name: '',
    sex,
    ethnicity: world.settlements[settlement]?.polity ?? 0,
    birth,
    settlement,
    fatherId: -1,
    motherId: -1,
    spouseId: -1,
    guardianId: -1,
    childIds: [],
    lastBirth: -10000,
    social: 50,
    math: 50,
    physical: 50,
    ambition: 0.5,
    integrity: 0.5,
    risk: 0.5,
    conformity: 0.5,
    diligence: 0.5,
    skills: new Array(NOCC).fill(0),
    occ: NO_OCC,
    parentOcc: NO_OCC,
    effort: 1,
    hours: 6,
    hoursAcc: 0,
    avgHours: 6,
    reputation: 1,
    lowRepMonths: 0,
    outsider: false,
    away: 0,
    food: 10,
    tools: 0,
    clothes: 0,
    plots: 0,
    toolCond: rng.range(0.4, 1),
    clothesCond: rng.range(0.4, 1),
    health: 1,
    hunger: 0,
    cold: 0,
    happiness: 0.6,
    grievance: 0,
    prestige: 0,
    output: 0,
    outputAcc: 0,
    prefs: [],
    role: 'none',
    notable: false,
    bio: [],
  };
}

/** A founder of the initial population. */
export function createFounder(world: World, rng: Rng, settlement: number, fixed?: { sex: 0 | 1; age: number; surname?: string }): Person {
  const sex: 0 | 1 = fixed ? fixed.sex : rng.chance(0.5) ? 1 : 0;
  // Age pyramid of a forager band: many young, few old
  const age = fixed ? fixed.age : Math.min(70, -ln(1 - rng.next() * 0.95) * 18);
  const p = blank(world, rng, sex, world.day - Math.floor(age * DAYS_PER_YEAR), settlement);
  p.name = randomName(rng, sex, fixed?.surname);
  p.social = ability(rng);
  p.math = ability(rng);
  p.physical = ability(rng);
  p.ambition = trait(rng);
  p.integrity = trait(rng);
  p.risk = trait(rng);
  p.conformity = trait(rng);
  p.diligence = trait(rng);
  p.prefs = initPrefs(rng, world.culture);
  p.prestige = (p.social - 50) / 50 + Math.min(age, 50) / 50;
  p.food = 20;
  return p;
}

/** Child abilities: partial heritability plus regression to the mean. */
export function createChild(world: World, rng: Rng, mother: Person, father: Person | undefined): Person {
  const sex: 0 | 1 = rng.chance(0.51) ? 1 : 0;
  const p = blank(world, rng, sex, world.day, mother.settlement);
  const surname = father ? surnameOf(father) : surnameOf(mother);
  p.name = randomName(rng, sex, surname);
  p.motherId = mother.id;
  p.ethnicity = father ? father.ethnicity : mother.ethnicity; // reckoned through the father
  p.fatherId = father ? father.id : -1;
  const h = world.params.heritability;
  const noise = Math.sqrt(1 - h * h);
  const inherit = (a: number, b: number, sd: number, mean: number, lo: number, hi: number) =>
    clamp(mean + h * ((a + b) / 2 - mean) + rng.normal() * sd * noise, lo, hi);
  const f = father ?? mother;
  p.social = inherit(mother.social, f.social, 15, 50, 1, 99);
  p.math = inherit(mother.math, f.math, 15, 50, 1, 99);
  p.physical = inherit(mother.physical, f.physical, 15, 50, 1, 99);
  p.ambition = inherit(mother.ambition, f.ambition, 0.2, 0.5, 0, 1);
  p.integrity = inherit(mother.integrity, f.integrity, 0.2, 0.5, 0, 1);
  p.risk = inherit(mother.risk, f.risk, 0.2, 0.5, 0, 1);
  p.conformity = inherit(mother.conformity, f.conformity, 0.2, 0.5, 0, 1);
  p.diligence = inherit(mother.diligence, f.diligence, 0.2, 0.5, 0, 1);
  // Culture is learned from parents
  p.prefs = mother.prefs.map((row, d) => normalize(row.map((v, i) => (v + f.prefs[d][i]) / 2 + rng.next() * 0.05)));
  p.parentOcc = father && father.occ >= 0 ? father.occ : mother.occ;
  p.food = 0;
  return p;
}

export function addBio(world: World, p: Person, text: string): void {
  p.bio.push({ day: world.day, text });
  if (p.bio.length > 40) p.bio.splice(1, 1);
}

// Runtime id index, rebuilt automatically when the people array changes.
const indexCache = new WeakMap<World, { arr: Person[]; len: number; map: Map<number, Person> }>();

export function personById(world: World, id: number): Person | undefined {
  if (id < 0) return undefined;
  let c = indexCache.get(world);
  if (!c || c.arr !== world.people || c.len !== world.people.length) {
    c = { arr: world.people, len: world.people.length, map: new Map(world.people.map((p) => [p.id, p])) };
    indexCache.set(world, c);
  }
  return c.map.get(id);
}

/** The option this person currently prefers most on a dimension. */
export function topPref(p: Person, dim: number): number {
  const row = p.prefs[dim];
  let best = 0;
  for (let i = 1; i < row.length; i++) if (row[i] > row[best]) best = i;
  return best;
}

