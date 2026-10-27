// Mortality calibration: deaths by cause, age at death, population per polity.
// Usage: npx tsx scripts/mortality.ts --seed demo --years 150 [--params baseMortality=0.7]
import { createWorld, step } from '../src/core/sim';
import { ageYears } from '../src/core/person';
import { allPolities } from '../src/core/nations';
import type { Person } from '../src/core/types';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const seed = arg('seed', 'demo');
const years = Number(arg('years', '150'));
const params = Object.fromEntries(arg('params', '').split(',').filter(Boolean).map((kv) => [kv.split('=')[0], Number(kv.split('=')[1])]));
const pop = Number(arg('pop', '200'));

const w = createWorld({ seed, params, population: pop });
const causes = new Map<string, number>();
const ageBands = [0, 0, 0, 0, 0]; // <1, 1-15, 15-40, 40-60, 60+
let adultAgeSum = 0, adults = 0;
let prev = new Map<number, Person>(w.people.map((p) => [p.id, p]));
for (let d = 1; d <= years * 360; d++) {
  step(w);
  const now = new Set(w.people.map((p) => p.id));
  for (const [id, p] of prev) {
    if (now.has(id)) continue;
    const text = p.bio[p.bio.length - 1]?.text ?? '';
    const cause = text.split('，')[0];
    causes.set(cause, (causes.get(cause) ?? 0) + 1);
    const a = ageYears(w, p);
    ageBands[a < 1 ? 0 : a < 15 ? 1 : a < 40 ? 2 : a < 60 ? 3 : 4]++;
    if (a >= 15) { adultAgeSum += a; adults++; }
  }
  prev = new Map(w.people.map((p) => [p.id, p]));
  if (d % (360 * 25) === 0) {
    const by = allPolities(w).map((pol) => w.people.filter((p) => w.settlements[p.settlement].polity === pol.id).length);
    console.log(`year ${d / 360}: total ${w.people.length}  polities ${by.join(' ')}`);
  }
}
const total = [...causes.values()].reduce((a, b) => a + b, 0);
console.log('deaths', total, [...causes].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${(100 * n / total).toFixed(1)}%`).join(' | '));
console.log('age at death <1/1-15/15-40/40-60/60+:', ageBands.map((n) => (100 * n / total).toFixed(0) + '%').join(' '));
console.log('mean age at death for those reaching 15:', (adultAgeSum / adults).toFixed(1));
const names = allPolities(w).map((p) => p.name);
console.log('polity names', names.join(' '), new Set(names).size === names.length ? '(unique)' : '(DUPLICATES)');
for (const s of w.settlements.filter((x) => x.alive && x.origin !== x.polity)) {
  const g = w.people.find((p) => p.id === s.governor);
  const folk = w.people.filter((p) => p.settlement === s.id);
  const ruling = folk.filter((p) => p.ethnicity === s.polity).length;
  console.log(`conquered ${s.name}: pop ${folk.length}, ruling ethnicity ${ruling}, governor ${g ? `${g.name} (eth ${g.ethnicity}, role ${g.role})` : 'none'}`);
}
const lead = allPolities(w).filter((p) => p.alive).map((pol) => {
  const l = w.people.find((p) => p.id === pol.leaderId);
  return l ? `${pol.name}:${l.ethnicity === pol.id ? 'own' : 'SUBJECT'}` : `${pol.name}:-`;
});
console.log('leaders', lead.join(' '));
const kinds = new Map<string, number>();
for (const e of w.events) {
  const k = e.title.replace(/^【[^】]*】/, '').split('：')[0];
  if (['分离', '投靠', '强留', '征服', '起义', '起义被镇压', '疫病', '新镇守', '宣战'].includes(k)) kinds.set(k, (kinds.get(k) ?? 0) + 1);
}
console.log('events (last 500 kept)', [...kinds].map(([k, n]) => `${k} ${n}`).join(' | '));
console.log('alive polities', allPolities(w).filter((p) => p.alive).length, 'of', allPolities(w).length);
