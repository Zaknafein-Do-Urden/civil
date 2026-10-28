// Baseline runs for scenario scores (DESIGN.md §16.4): each scenario played by the state on its own
// (every decision card at its customary choice), several luck seeds each. The mean and spread of each
// indicator become the 60-point mark. Resumable: finished runs are kept in the results file, and a
// running one is checkpointed every few years, so an interrupted calibration picks up where it stopped.
//
// Usage: npx tsx scripts/calibrate.ts [--runs 8] [--only tribe,frontier] [--every 10]

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createWorld, deserialize, runDays, serialize } from '../src/core/sim';
import { SCENARIOS } from '../src/core/scenarios';
import { PLAYER } from '../src/core/nations';
import type { World } from '../src/core/types';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const DIR = 'scripts/calibration';
const RESULTS = `${DIR}/results.json`;
const CKPT = `${DIR}/checkpoint`;
const runs = Number(arg('runs', '8'));
const every = Number(arg('every', '10'));
const only = arg('only', '').split(',').filter(Boolean);

/** Counted as they happen, since old events are dropped from the log. */
interface Tally {
  revolutions: number;
  coups: number;
  lostSettlements: number;
  conquests: number;
  famines: number;
  lastSeq: number;
}

interface RunResult {
  scenario: string;
  seed: string;
  years: number;
  status: string;
  endYear: number;
  indicators: Record<string, number>;
}

function save(path: string, data: unknown): void {
  writeFileSync(`${path}.tmp`, JSON.stringify(data));
  renameSync(`${path}.tmp`, path); // never leave a half-written file behind
}

function load<T>(path: string, def: T): T {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : def;
}

function count(w: World, t: Tally): void {
  for (const e of w.events) {
    if (e.seq < t.lastSeq || e.polity !== undefined) continue;
    if (e.title === '革命成功') t.revolutions++;
    else if (e.title.startsWith('政变：')) t.coups++;
    else if (e.title === '大饥荒') t.famines++;
    else if ((e.title.startsWith('分离：') || e.title.startsWith('投靠：')) && e.text.includes(w.polity.name)) t.lostSettlements++;
    else if (e.title.startsWith('征服：') && e.title.endsWith(w.polity.name)) t.conquests++;
  }
  t.lastSeq = w.eventSeq;
}

function indicators(w: World, t: Tally): Record<string, number> {
  const st = w.stats;
  const mean = (f: (s: (typeof st)[number]) => number) => (st.length ? st.reduce((a, s) => a + f(s), 0) / st.length : 0);
  let pop = 0;
  for (const p of w.people) if (w.settlements[p.settlement].polity === PLAYER) pop++;
  return {
    pop,
    settlements: w.settlements.filter((s) => s.alive && s.polity === PLAYER).length,
    worldShare: pop / Math.max(1, w.people.length),
    starvedRate: mean((s) => (s.pop ? s.starved / s.pop : 0)),
    health: mean((s) => s.health),
    happiness: mean((s) => s.happiness),
    legitimacy: mean((s) => s.legitimacy),
    gini: st.length ? st[st.length - 1].gini : 0,
    techs: w.tech.known.filter(Boolean).length,
    revolutions: t.revolutions,
    coups: t.coups,
    lostSettlements: t.lostSettlements,
    conquests: t.conquests,
    famines: t.famines,
  };
}

mkdirSync(DIR, { recursive: true });
const results = load<RunResult[]>(RESULTS, []);

for (const sc of SCENARIOS) {
  if (sc.id === 'sandbox' || (only.length && !only.includes(sc.id))) continue;
  for (let i = 1; i <= runs; i++) {
    const seed = `cal-${i}`;
    if (results.some((r) => r.scenario === sc.id && r.seed === seed)) continue;
    const t0 = Date.now();
    // resume a run that was cut short
    const ck = load<{ scenario: string; seed: string; world: string; tally: Tally } | undefined>(CKPT, undefined);
    let w: World;
    let tally: Tally;
    if (ck && ck.scenario === sc.id && ck.seed === seed) {
      w = deserialize(ck.world);
      tally = ck.tally;
      console.log(`${sc.id} ${seed}: resuming at year ${Math.floor(w.day / 360)}`);
    } else {
      w = createWorld({ ...sc.config, seed: sc.config.seed ?? 'demo', scenario: sc.id, rngSeed: seed });
      tally = { revolutions: 0, coups: 0, lostSettlements: 0, conquests: 0, famines: 0, lastSeq: 0 };
    }
    while (w.day < sc.years * 360 && w.people.length) {
      runDays(w, 360);
      count(w, tally);
      const y = Math.floor(w.day / 360);
      if (y % every === 0) {
        save(CKPT, { scenario: sc.id, seed, world: serialize(w), tally });
        console.log(`${sc.id} ${seed}: year ${y}, ${Math.round((Date.now() - t0) / 1000)} s`);
      }
    }
    const st = w.scenario;
    results.push({
      scenario: sc.id, seed, years: sc.years, status: st.status,
      endYear: st.endDay >= 0 ? st.endDay / 360 : -1, indicators: indicators(w, tally),
    });
    save(RESULTS, results);
    if (existsSync(CKPT)) unlinkSync(CKPT);
    console.log(`${sc.id} ${seed}: done (${st.status}) in ${Math.round((Date.now() - t0) / 1000)} s`);
  }
}

// summary: mean and standard deviation of each indicator per scenario
for (const sc of SCENARIOS) {
  const rs = results.filter((r) => r.scenario === sc.id);
  if (!rs.length) continue;
  console.log(`\n== ${sc.name}: ${rs.length} runs, won ${rs.filter((r) => r.status === 'won').length}`);
  for (const k of Object.keys(rs[0].indicators)) {
    const xs = rs.map((r) => r.indicators[k]);
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1));
    console.log(`  ${k}: ${m.toFixed(3)} ± ${sd.toFixed(3)}`);
  }
}
