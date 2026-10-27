// Gradient of state control (DESIGN.md §5.1): core → province → vassal → beyond reach.
//
// Enforcement (distance to the capital against administrative reach) places each settlement on a tier.
// The further out, the less of the tax reaches the centre and the fewer men answer a levy; the local
// ruler — a governor sent by the centre, or a hereditary headman of the place — keeps part of the
// difference for his family. Vassals follow their own customs and pay a nominal tribute.

import { clamp } from './dmath';
import { addBio, ageYears, personById } from './person';
import { ADULT_AGE } from './types';
import type { Person, Settlement, World } from './types';

export type Tier = 'core' | 'province' | 'vassal' | 'fringe';

export const TIER_NAMES: Record<Tier, string> = { core: '核心', province: '地方', vassal: '附庸', fringe: '化外' };
export const CORE_ENFORCEMENT = 0.75;

export function tier(world: World, s: Settlement): Tier {
  const P = world.params;
  if (s.enforcement >= CORE_ENFORCEMENT) return 'core';
  if (s.enforcement >= P.enforceThreshold) return 'province';
  if (s.enforcement >= P.vassalThreshold) return 'vassal';
  return 'fringe';
}

/** Share of the tax collected here that reaches the national treasury. */
export function remitShare(world: World, s: Settlement): number {
  switch (tier(world, s)) {
    case 'core':
      return 1;
    case 'province':
      return s.enforcement;
    case 'vassal':
      return world.params.vassalTribute;
    default:
      return 0;
  }
}

/** Share of a levy's men that actually come when the centre calls. */
export function levyObedience(world: World, s: Settlement): number {
  switch (tier(world, s)) {
    case 'core':
      return 1;
    case 'province':
      return s.enforcement;
    case 'vassal':
      return 0.25;
    default:
      return 0.05;
  }
}

/** Collection works wherever someone local collects; beyond reach hardly anything is taken. */
export function collection(world: World, s: Settlement): number {
  const v = world.params.vassalThreshold;
  return s.enforcement >= v ? 1 : clamp(s.enforcement / Math.max(0.01, v), 0, 1);
}

/** The settlement's own ruler: the centre's governor, or the local headman. */
export function localRuler(world: World, s: Settlement): Person | undefined {
  const g = personById(world, s.governor);
  if (g && g.settlement === s.id && g.role === 'governor') return g;
  const c = personById(world, s.chief);
  if (c && c.settlement === s.id && c.role === 'chief') return c;
  return undefined;
}

/** How much of what does not go up the local ruler keeps for his family; the rest stays in the granary. */
export function greed(p: Person): number {
  return 0.3 + 0.7 * (1 - p.integrity);
}

/** Split a tax amount: [to the treasury, to the local ruler, to the settlement pool]. */
export function splitTax(world: World, s: Settlement, ruler: Person | undefined): [number, number, number] {
  const up = remitShare(world, s);
  const lord = ruler ? (1 - up) * greed(ruler) : 0;
  return [up, lord, 1 - up - lord];
}

/**
 * Yearly, on a polity view: settlements outside the core get a headman (eldest adult son of the last one,
 * else the most respected man of the place); core settlements need none. Also rolls the skim tally.
 */
export function updateLocalRulers(world: World, groups: Person[][]): void {
  const pol = world.polity;
  for (const s of world.settlements) {
    if (!s.alive) continue;
    s.skimmed = s.skimAcc;
    s.skimAcc = 0;
    const people = groups[s.id] ?? [];
    const cur = personById(world, s.chief);
    const valid = cur && cur.settlement === s.id && cur.role === 'chief';
    const gov = personById(world, s.governor);
    const governed = gov && gov.settlement === s.id && gov.role === 'governor';
    if (tier(world, s) === 'core' || governed || s.origin !== s.polity || !people.length) {
      if (valid) {
        cur.role = 'none';
        addBio(world, cur, `${s.name}归中央直接管辖，不再任头人`);
      }
      s.chief = -1;
      continue;
    }
    if (valid) continue;
    const men = people.filter((p) => p.sex === 1 && p.role === 'none' && ageYears(world, p) >= ADULT_AGE + 4 && ageYears(world, p) < 65);
    if (!men.length) continue;
    const sons = men.filter((p) => s.chief >= 0 && p.fatherId === s.chief).sort((a, b) => a.birth - b.birth || a.id - b.id);
    let pick = sons[0];
    if (!pick) {
      pick = men[0];
      for (const p of men) if (p.prestige > pick.prestige || (p.prestige === pick.prestige && p.id < pick.id)) pick = p;
    }
    pick.role = 'chief';
    pick.notable = true;
    addBio(world, pick, sons[0] ? `继承父位，成为${s.name}的头人` : `成为${s.name}的头人，名义上听命于${pol.name}`);
    s.chief = pick.id;
  }
}
