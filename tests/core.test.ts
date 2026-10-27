import { describe, expect, it } from 'vitest';
import { createWorld, deserialize, issue, runDays, serialize, stateHash } from '../src/core/sim';
import { PRESETS } from '../src/core/rules';
import { exp, ln, pow } from '../src/core/dmath';
import { Rng, seedRng } from '../src/core/rng';
import { DAYS_PER_YEAR } from '../src/core/types';
import { TILE_HISTORY_YEARS, decodeTileSnapshot, recordTileHistory } from '../src/core/tiles';

const preset = (id: string) => PRESETS.find((p) => p.id === id)!.culture;

describe('deterministic math', () => {
  it('matches Math within tolerance', () => {
    for (const x of [-5, -1, -0.3, 0, 0.5, 1, 2.7, 10]) expect(exp(x)).toBeCloseTo(Math.exp(x), 10);
    for (const x of [0.01, 0.5, 1, 2, 10, 12345]) expect(ln(x)).toBeCloseTo(Math.log(x), 10);
    expect(pow(1.09, 15)).toBeCloseTo(Math.pow(1.09, 15), 9);
  });

  it('rng is reproducible from a seed', () => {
    const a = new Rng(seedRng('x'));
    const b = new Rng(seedRng('x'));
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
});

describe('simulation', () => {
  it('is deterministic for the same seed and culture', () => {
    const a = createWorld({ seed: 'det', culture: preset('liberal') });
    const b = createWorld({ seed: 'det', culture: preset('liberal') });
    runDays(a, 400);
    runDays(b, 400);
    expect(stateHash(a)).toBe(stateHash(b));
  });

  it('diverges for different cultures on the same map', () => {
    const a = createWorld({ seed: 'det', culture: preset('primitive') });
    const b = createWorld({ seed: 'det', culture: preset('planned') });
    expect(a.map.tiles.map((t) => t.terrain)).toEqual(b.map.tiles.map((t) => t.terrain));
    runDays(a, 200);
    runDays(b, 200);
    expect(stateHash(a)).not.toBe(stateHash(b));
  });

  it('continues identically after a save/load round trip', () => {
    const a = createWorld({ seed: 'save', culture: preset('chiefdom') });
    runDays(a, 250);
    const b = deserialize(serialize(a));
    runDays(a, 200);
    runDays(b, 200);
    expect(stateHash(b)).toBe(stateHash(a));
  });

  it('replays player commands deterministically', () => {
    const run = () => {
      const w = createWorld({ seed: 'cmd', culture: preset('feudal') });
      runDays(w, 100);
      issue(w, { day: w.day, type: 'movement', dim: 0, opt: 0, strength: 0.3 });
      runDays(w, 100);
      return w;
    };
    const a = run();
    const b = run();
    expect(a.commandLog.length).toBe(1);
    expect(stateHash(a)).toBe(stateHash(b));
    expect(a.events.some((e) => e.kind === 'movement')).toBe(true);
  });

  it('keeps a forager tribe alive for a decade', () => {
    const w = createWorld({ seed: 'alive', culture: preset('primitive') });
    runDays(w, 10 * DAYS_PER_YEAR);
    expect(w.people.length).toBeGreaterThan(600);
    expect(w.stats.length).toBe(10);
    expect(w.polity.leaderId).toBeGreaterThan(0);
  });
});

describe('tile history', () => {
  it('records yearly, round-trips through save and keeps only 100 years', () => {
    const w = createWorld({ seed: 'tiles', culture: preset('primitive') });
    runDays(w, 2 * DAYS_PER_YEAR);
    expect(w.tileHistory.days).toEqual([DAYS_PER_YEAR, 2 * DAYS_PER_YEAR]);
    const snap = decodeTileSnapshot(w.map, w.tileHistory.data[1]);
    for (const t of w.map.tiles) {
      if (t.plantsCap > 0) expect(Math.abs(snap.plants[t.id] - t.plants / t.plantsCap)).toBeLessThan(0.003);
      if (t.maxPlots > 0) expect(Math.abs(snap.plots[t.id] - t.plots)).toBeLessThan(0.13);
      if (t.terrain !== 'ocean' && t.terrain !== 'lake') expect(snap.owner[t.id]).toBe(t.owner);
    }
    const b = deserialize(serialize(w));
    expect(b.tileHistory).toEqual(w.tileHistory);
    for (let i = 0; i < 105; i++) recordTileHistory(w);
    expect(w.tileHistory.days.length).toBe(TILE_HISTORY_YEARS);
  });
});

describe('multiple polities', () => {
  it('places NPC tribes that are simulated by the same rules', () => {
    const w = createWorld({ seed: 'npc', population: 400, npcCount: 3, npcPopulation: 150 });
    expect(w.npcs.length).toBe(3);
    for (const sc of w.npcs) {
      expect(sc.polity.alive).toBe(true);
      expect(sc.polity.leaderId).toBeGreaterThan(0);
      expect(w.settlements.some((s) => s.alive && s.polity === sc.polity.id)).toBe(true);
    }
    runDays(w, 2 * DAYS_PER_YEAR);
    for (const sc of w.npcs) expect(sc.stats.length).toBe(2);
    // every person lives in a settlement of a living polity
    const alive = new Set([w.polity, ...w.npcs.map((n) => n.polity)].filter((p) => p.alive).map((p) => p.id));
    for (const p of w.people) expect(alive.has(w.settlements[p.settlement].polity)).toBe(true);
  });

  it('brings neighbours into contact', () => {
    const w = createWorld({ seed: 'npc', population: 400, npcCount: 3, npcPopulation: 150 });
    runDays(w, 3 * DAYS_PER_YEAR);
    const n = 1 + w.npcs.length; // breakaway settlements may have founded more polities
    expect(n).toBeGreaterThanOrEqual(4);
    expect(w.relations.length).toBe((n * (n - 1)) / 2);
    expect(w.relations.some((r) => r.status !== 'none')).toBe(true);
    expect(w.events.some((e) => e.title.startsWith('首次接触'))).toBe(true);
  });

  it('stays deterministic through war and a save/load round trip', () => {
    const make = () => {
      const w = createWorld({
        seed: 'war', population: 400, npcCount: 2, npcPopulation: 200,
        params: { contactRange: 40, campaignRange: 40, warPropensity: 3 },
      });
      issue(w, { day: 0, type: 'warMood', value: 1 });
      return w;
    };
    const a = make();
    runDays(a, 10 * DAYS_PER_YEAR);
    expect(a.warSeq).toBeGreaterThan(0);
    expect(a.commandLog.length).toBe(1);
    const b = deserialize(serialize(a));
    const c = make();
    runDays(c, 10 * DAYS_PER_YEAR);
    expect(stateHash(c)).toBe(stateHash(a));
    runDays(a, 2 * DAYS_PER_YEAR);
    runDays(b, 2 * DAYS_PER_YEAR);
    expect(stateHash(b)).toBe(stateHash(a));
  });
});

describe('factions, suffrage and checks', () => {
  it('forms factions whose members point at existing factions', () => {
    const w = createWorld({ seed: 'fx', culture: preset('liberal'), population: 300, npcCount: 0 });
    runDays(w, 3 * DAYS_PER_YEAR);
    const ids = new Set(w.polity.factions.map((f) => f.id));
    expect(w.polity.factions.length).toBeGreaterThan(1);
    for (const p of w.people) if (p.faction >= 0) expect(ids.has(p.faction)).toBe(true);
    const power = w.polity.factions.reduce((a, f) => a + f.power, 0);
    expect(power).toBeLessThanOrEqual(1.0001);
  });

  it('loads saves from before the suffrage and checks dimensions', () => {
    const w = createWorld({ seed: 'oldsave', population: 200, npcCount: 1, npcPopulation: 100 });
    runDays(w, 100);
    const old = JSON.parse(serialize(w));
    for (const sc of [old, ...old.npcs]) {
      delete sc.polity.factions;
      delete sc.polity.factionSeq;
      delete sc.polity.vetoed;
      sc.polity.institutions.length = 9;
      sc.polity.active.length = 9;
    }
    for (const s of old.settlements) s.practiced.length = 9;
    for (const p of old.people) {
      p.prefs.length = 9;
      delete p.faction;
      delete p.noble;
      delete p.rank;
      delete p.originRank;
    }
    const b = deserialize(JSON.stringify(old));
    expect(b.polity.institutions.length).toBe(11);
    expect(b.people[0].prefs.length).toBe(11);
    runDays(b, DAYS_PER_YEAR);
    expect(b.stats.length).toBe(1);
  });
});
