// Usage: npx tsx scripts/hashcheck.ts [days]
// Prints stateHash after a short run for a few configurations: run before and after a
// performance change, the hashes must match exactly.
import { PRESETS } from '../src/core/rules';
import { createWorld, runDays, stateHash } from '../src/core/sim';
const days = Number(process.argv[2] ?? 720);
const configs = [
  { seed: 'demo', preset: 'liberal', params: undefined },
  { seed: '黄河42', preset: 'feudal', params: undefined },
];
for (const c of configs) {
  const w = createWorld({ seed: c.seed, culture: PRESETS.find((p) => p.id === c.preset)!.culture, params: c.params });
  const t0 = performance.now();
  runDays(w, days);
  console.log(`${c.seed}/${c.preset}: ${stateHash(w)} pop ${w.people.length} techs ${w.tech.known.filter(Boolean).length} ${((days / (performance.now() - t0)) * 1000).toFixed(0)} days/s`);
}
