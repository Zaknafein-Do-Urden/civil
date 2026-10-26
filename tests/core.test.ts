import { describe, expect, it } from 'vitest';
import { createWorld, deserialize, issue, runDays, serialize, stateHash } from '../src/core/sim';
import { PRESETS } from '../src/core/rules';
import { exp, ln, pow } from '../src/core/dmath';
import { Rng, seedRng } from '../src/core/rng';
import { DAYS_PER_YEAR } from '../src/core/types';

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
