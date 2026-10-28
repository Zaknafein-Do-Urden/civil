// Decision cards (DESIGN.md §14): where the simulation would decide something for the player's state by
// itself, it asks the player instead. NPC polities, and the player's in headless runs, take `auto`.
// Resolution lives in statecraft.ts; this module only raises and tracks them, so any module can.

import { addEvent } from './events';
import type { Decision, DecisionKind, World } from './types';

/** Should polity `pid` wait for the player here rather than decide by itself? */
export function playerDecides(world: World, pid: number): boolean {
  return pid === 0 && !world.autoDecide;
}

export function seenKey(kind: DecisionKind, subject: number): string {
  return `${kind}:${subject}`;
}

/** A decision about this subject is waiting, or one was raised or settled within `days`. */
export function asked(world: World, kind: DecisionKind, subject: number, days: number): boolean {
  if (world.decisions.some((d) => d.kind === kind && subjectOf(d) === subject)) return true;
  const last = world.decisionSeen[seenKey(kind, subject)];
  return last !== undefined && world.day - last < days;
}

/** Settlement for most kinds; the dimension for reforms. */
export function subjectOf(d: Decision): number {
  return d.kind === 'reform' ? d.data[0] : d.settlement;
}

/** Put a decision to the player; the announcing event pauses the game. */
export function propose(world: World, d: Omit<Decision, 'id' | 'day' | 'due'>): void {
  const id = world.eventSeq;
  world.decisions.push({ ...d, id, day: world.day, due: world.day + world.params.decisionDays });
  world.decisionSeen[seenKey(d.kind, d.kind === 'reform' ? d.data[0] : d.settlement)] = world.day;
  addEvent(world, 'decision', true, `待决：${d.title}`, d.text, d.people, d.settlement);
}
