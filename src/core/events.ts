import type { EventKind, World } from './types';

const MAX_EVENTS = 3000;

export function addEvent(
  world: World,
  kind: EventKind,
  major: boolean,
  title: string,
  text: string,
  people: number[] = [],
  settlement = -1,
): void {
  world.events.push({ seq: world.eventSeq++, day: world.day, kind, major, title, text, people, settlement });
  if (world.events.length > MAX_EVENTS) world.events.splice(0, world.events.length - MAX_EVENTS);
}

export function formatDate(day: number): string {
  const y = Math.floor(day / 360) + 1;
  const m = Math.floor((day % 360) / 30) + 1;
  const d = (day % 30) + 1;
  return `第${y}年${m}月${d}日`;
}
