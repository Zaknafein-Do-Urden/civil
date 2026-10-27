// Preference drift (DESIGN.md §2.1): self-interest, conformity, experience, habituation, propaganda.

import { clamp } from './dmath';
import { ALLOC, D, DIMS, SPEECH } from './rules';
import { ageYears, normalize, personById } from './person';
import { aptitude, settlementAverages, wealth } from './economy';
import { ADULT_AGE, NOCC, OCC } from './types';
import type { Person, Settlement, World } from './types';

interface Ctx {
  relO: number;
  relW: number;
  elite: number;
  isLeader: number;
  leaderKin: number;
  top: number;
  dependents: number;
  poor: number;
  landlessFarmer: number;
  farmer: number;
  mismatch: number;
  age: number;
  noble: number;
  /** Share of adults who are noble. */
  nobleShare: number;
  /** Not of the leader's people. */
  minority: number;
  /** In the leader's faction, or in another faction. */
  ruling: number;
  opposition: number;
}

/** Self-interest score per option, centred so the mean across options is zero. */
function interest(world: World, p: Person, d: number, c: Ctx): number[] {
  const a = (x: number) => (x - 50) / 50;
  const L = world.polity.legitimacy;
  let s: number[];
  switch (d) {
    case D.allocation:
      s = [
        0.6 * (1 - c.relO) + 0.3 * (1 - c.relW) + 0.1 * c.dependents + 0.5 * p.hunger - 0.4 * (p.ambition - 0.5),
        0.6 * (c.relO - 1) + 0.4 * (p.ambition - 0.5) + 0.3 * (c.relW - 1),
        0.8 * c.elite + 0.3 * p.hunger * (1 - p.risk) - 0.3 * (c.relO - 1) - 0.2,
      ];
      break;
    case D.land:
      s = [
        0.6 * c.landlessFarmer + 0.3 * c.poor,
        0.8 * Math.min(1, p.plots) + 0.3 * (p.ambition - 0.5) + 0.2 * c.farmer * (c.relO - 1),
        1.0 * c.isLeader + 0.4 * c.elite - 0.4 * c.farmer,
      ];
      break;
    case D.occupation:
      s = [
        0.4 * p.ambition + 0.4 * c.mismatch,
        0.8 * c.elite + 0.2 * (1 - p.risk) - 0.3,
        0.5 * (c.relW > 1.5 ? 1 : 0) + 0.3 * (c.age > 45 ? 1 : 0) - 0.2,
      ];
      break;
    case D.distribution:
      s = [
        0.6 * (1 - c.relO) + 0.2,
        0.15 * c.dependents + 0.5 * p.hunger + 0.3 * (c.age > 55 ? 1 : 0) + 0.3 * (1 - p.health),
        0.7 * (c.relO - 1),
        1.0 * c.elite + 0.4 * c.top - 0.3,
      ];
      break;
    case D.tax:
      s = [
        0.5 * (c.relW - 1) + 0.3 * (c.relO - 1),
        0.1,
        0.6 * c.elite + 0.4 * c.poor - 0.4 * (c.relW - 1),
      ];
      break;
    case D.authority:
      s = [
        1.5 * c.isLeader + 0.3 * (L - 0.5),
        1.0 * (p.role === 'council' ? 1 : 0) + 0.5 * c.top - 0.1,
        0.4 * (1 - c.top) + 0.2 * (p.social > 60 ? 1 : 0) - 0.5 * c.isLeader,
      ];
      break;
    case D.succession:
      s = [
        0.5 * c.top,
        0.4 * a(p.social) + 0.3 * (1 - c.top),
        1.2 * c.leaderKin + 0.2 * (c.age > 50 ? 1 : 0),
        0.6 * a(p.physical) * p.ambition + 0.3 * (p.ambition - 0.5) - 0.3,
        0.6 * a(p.math) + 0.2 * a(p.social),
      ];
      break;
    case D.inheritance:
      s = [
        0.3 * (c.dependents > 1 ? 1 : 0),
        0.6 * (c.relW > 1.5 ? 1 : 0) + 0.3 * c.leaderKin,
        0.5 * c.poor - 0.3 * (c.relW - 1),
      ];
      break;
    case D.speech:
      s = [
        0.6 * p.grievance + 0.3 * a(p.math) + 0.1,
        0,
        0.8 * c.isLeader * (1 - L) + 0.4 * c.elite - 0.2,
      ];
      break;
    case D.suffrage: {
      // everyone wants a franchise that includes them and leaves out rivals
      const rich = c.relW >= 1 ? 1 : 0;
      s = [
        0.3 * (1 - p.sex) + 0.3 * c.poor + 0.4 * c.minority + 0.2 * (1 - c.top),
        0.3 * p.sex * (1 - c.minority) - 0.3 * (1 - p.sex) + 0.1 * p.conformity,
        0.6 * rich + 0.3 * Math.min(1, p.plots) - 0.5 * c.poor,
        0.4 * (1 - c.minority) - 0.9 * c.minority,
        // a noble franchise is only worth having while nobles are few
        (1.0 * c.noble + 0.4 * c.elite) * (1 - c.nobleShare) - 0.4,
      ];
      break;
    }
    default: // checks
      s = [
        1.5 * c.isLeader + 0.5 * c.leaderKin + 0.3 * c.ruling - 0.1,
        0.8 * (p.role === 'council' ? 1 : 0) + 0.3 * c.top + 0.2 * c.noble + 0.2 * c.opposition,
        0.4 * (1 - c.top) + 0.4 * p.grievance + 0.3 * c.opposition + 0.2 * p.integrity - 0.8 * c.isLeader,
      ];
  }
  let m = 0;
  for (const v of s) m += v;
  m /= s.length;
  return s.map((v) => clamp(v - m, -1, 1));
}

export function cultureMonthly(world: World, groups: Person[][]): void {
  const P = world.params;
  const pol = world.polity;
  const l = personById(world, pol.leaderId);
  const kin = new Set<number>();
  if (l) {
    kin.add(l.id);
    for (const id of [l.spouseId, l.fatherId, l.motherId, ...l.childIds]) kin.add(id);
  }
  const prestigeSorted = world.people.map((p) => p.prestige).sort((a, b) => a - b);
  const topCut = prestigeSorted[Math.floor(prestigeSorted.length * 0.9)] ?? Infinity;
  let nobles = 0;
  let grown = 0;
  for (const p of world.people) {
    if (ageYears(world, p) < ADULT_AGE) continue;
    grown++;
    if (p.noble) nobles++;
  }
  const nobleShare = grown ? nobles / grown : 0;

  for (const s of world.settlements) {
    const people = groups[s.id];
    if (!s.alive || !people?.length) continue;
    const mean = settlementMean(people);
    const { avgOut: avgO, avgWealth: avgW } = settlementAverages(world, s, people);
    const controlled = s.practiced[D.speech] === SPEECH.controlled;

    for (const p of people) {
      const age = ageYears(world, p);
      if (age < ADULT_AGE) continue;
      const c = context(world, p, s, avgO, avgW, kin, topCut, age, l, nobleShare);
      const suffering = clamp(p.hunger + p.cold * 0.5, 0, 1);
      for (let d = 0; d < DIMS.length; d++) {
        const row = p.prefs[d];
        const n = row.length;
        const conform = P.conformRate * (0.5 + p.conformity);
        for (let o = 0; o < n; o++) row[o] += conform * (mean[d][o] - row[o]);
        if (!pol.active[d]) {
          normalize(row);
          continue;
        }
        const sc = interest(world, p, d, c);
        const ir = P.interestRate * (1 - 0.5 * p.conformity);
        for (let o = 0; o < n; o++) row[o] += ir * sc[o];
        const practiced = s.practiced[d];
        // people blame the economic and political order they suffer under
        if (suffering > 0.2 && (d === D.allocation || d === D.distribution || d === D.tax || d === D.authority)) {
          row[practiced] -= P.experienceRate * suffering * (1 - 0.5 * p.conformity);
        }
        row[practiced] += 0.0015; // habituation
        if (controlled) row[pol.institutions[d]] += 0.004 * p.conformity;
        normalize(row);
      }
    }
  }
}

function settlementMean(people: Person[]): number[][] {
  const mean = DIMS.map((d) => new Array<number>(d.options.length).fill(0));
  let tw = 0;
  for (const p of people) {
    const w = 1 + Math.max(0, p.prestige);
    tw += w;
    for (let d = 0; d < DIMS.length; d++) for (let o = 0; o < mean[d].length; o++) mean[d][o] += w * p.prefs[d][o];
  }
  for (const row of mean) for (let o = 0; o < row.length; o++) row[o] /= tw || 1;
  return mean;
}

function context(world: World, p: Person, s: Settlement, avgO: number, avgW: number, kin: Set<number>, topCut: number, age: number, l: Person | undefined, nobleShare: number): Ctx {
  let dependents = 0;
  for (const id of p.childIds) {
    const k = personById(world, id);
    if (k && ageYears(world, k) < ADULT_AGE) dependents++;
  }
  let mismatch = 0;
  if (p.occ >= 0 && p.occ !== OCC.admin) {
    const cur = aptitude(world, p, p.occ);
    let best = cur;
    for (let o = 0; o < NOCC; o++) if (o !== OCC.admin && o !== OCC.tinker) best = Math.max(best, aptitude(world, p, o));
    mismatch = clamp(best / cur - 1, 0, 1);
  }
  const relW = clamp(wealth(p, s) / avgW, 0, 3);
  const elite = p.role !== 'none' || p.occ === OCC.admin ? 1 : 0;
  return {
    relO: clamp(p.output / avgO, 0, 3),
    relW,
    elite,
    isLeader: p.role === 'leader' ? 1 : 0,
    leaderKin: kin.has(p.id) ? 1 : 0,
    top: p.prestige >= topCut ? 1 : 0,
    dependents,
    poor: relW < 0.5 ? 1 : 0,
    landlessFarmer: p.occ === OCC.farm && p.plots < 1 && s.practiced[D.allocation] !== ALLOC.command ? 1 : 0,
    farmer: p.occ === OCC.farm ? 1 : 0,
    mismatch,
    age,
    noble: p.noble ? 1 : 0,
    nobleShare,
    minority: l && p.ethnicity !== l.ethnicity ? 1 : 0,
    ruling: l && l.faction >= 0 && p.faction === l.faction ? 1 : 0,
    opposition: p.faction >= 0 && (!l || p.faction !== l.faction) ? 1 : 0,
  };
}
