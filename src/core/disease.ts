// Epidemics (crowd diseases) and hunting accidents.
//
// Crowd diseases need many hosts living close together: a band of fifty never sustains one, a village
// of five hundred does. Herd animals add zoonoses. An outbreak lasts two months, spreads to nearby
// settlements of any polity, and leaves the survivors immune; immunity fades as children are born.

import { clamp } from './dmath';
import { addEvent } from './events';
import { hexDistance } from './map';
import { PLAYER, polityOf, scopeOf } from './nations';
import { TECH_INDEX, has } from './tech';
import type { Rng } from './rng';
import { DAYS_PER_YEAR, OCC } from './types';
import type { Person, Settlement, World } from './types';

export const EPIDEMIC_DAYS = 60;
const SPREAD_RANGE = 4;
const DISEASES = ['天花', '麻疹', '痢疾', '伤寒', '瘟疫', '疟疾'];

function knows(world: World, pid: number, tech: string): boolean {
  return scopeOf(world, pid).tech.known[TECH_INDEX[tech]];
}

/** Today's chance that `p` dies of the running epidemic in `s`. */
export function epidemicRisk(world: World, s: Settlement, p: Person, age: number): number {
  if (s.epidemic <= 0) return 0;
  let frail = age < 5 || age > 55 ? 2 : 1;
  if (p.health < 0.5) frail *= 1.5;
  return (s.epiSeverity * world.params.epidemicLethality * frail) / EPIDEMIC_DAYS;
}

/** Today's chance that a hunter is killed in the chase: more hours, weaker body, worse weapons → higher. */
export function huntRisk(world: World, p: Person): number {
  if (p.occ !== OCC.hunt || p.hours <= 0) return 0;
  const weapons = has(world, 'bow') ? 0.7 : 1; // runs on a polity view
  return (world.params.huntDanger * (p.hours / 8) * (1.5 - p.physical / 100) * weapons) / DAYS_PER_YEAR;
}

function outbreak(world: World, s: Settlement, severity: number, name: string, from?: Settlement): void {
  s.epidemic = EPIDEMIC_DAYS;
  s.epiSeverity = clamp(severity, 0.1, 1);
  s.epiDeaths = 0;
  s.epiName = name;
  const pol = polityOf(world, s.polity);
  addEvent(world, 'famine', s.polity === PLAYER, `疫病：${s.name}`,
    `${pol.name}的${s.name}${from ? `从${from.name}传来了` : '爆发了'}${name}${s.epiSeverity > 0.6 ? '，来势凶猛' : ''}。`, [], s.id);
}

/** Monthly, over all polities: outbreaks, spread, end of epidemics, fading immunity. */
export function diseaseMonthly(world: World, rng: Rng): void {
  const P = world.params;
  const live = world.settlements.filter((s) => s.alive);
  const running = live.filter((s) => s.epidemic > 0);
  for (const s of running) {
    const name = s.epiName || '疫病';
    for (const o of live) {
      if (o.epidemic > 0 || o === s) continue;
      if (hexDistance(world.map.tiles[s.tile], world.map.tiles[o.tile]) > SPREAD_RANGE) continue;
      const hosts = clamp(o.pop / 100, 0.2, 1);
      if (rng.chance(0.3 * hosts * (1 - o.immunity))) outbreak(world, o, s.epiSeverity * rng.range(0.6, 1), name, s);
    }
  }
  for (const s of live) {
    if (s.epidemic > 0) {
      s.epidemic -= 30;
      if (s.epidemic > 0) continue;
      s.epidemic = 0;
      s.immunity = 1;
      const name = s.epiName || '疫病';
      addEvent(world, 'famine', s.polity === PLAYER && s.epiDeaths > 0, `疫病平息：${s.name}`,
        `${s.name}的${name}过去了，${s.epiDeaths ? `共 ${s.epiDeaths} 人病死` : '没有人病死'}。幸存者不再染上这种病。`, [], s.id);
      continue;
    }
    s.immunity *= 0.995; // about 11 years to halve as the immune die and children are born
    const crowd = clamp((s.pop - 100) / 400, 0, 2);
    if (crowd <= 0) continue;
    const herds = knows(world, s.polity, 'husbandry') ? 1.5 : 1;
    if (rng.chance(P.epidemicRate * crowd * herds * (1 - s.immunity))) outbreak(world, s, rng.range(0.3, 1), rng.pick(DISEASES));
  }
}
