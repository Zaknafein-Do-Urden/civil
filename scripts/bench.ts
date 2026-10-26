import { PRESETS } from '../src/core/rules';
import { createWorld, runDays } from '../src/core/sim';
const w = createWorld({ seed: 'demo', culture: PRESETS.find(p=>p.id===(process.argv[2]??'liberal'))!.culture });
const t0 = performance.now();
runDays(w, 360 * Number(process.argv[3] ?? 20));
console.log(`${((360 * Number(process.argv[3] ?? 20)) / ((performance.now() - t0) / 1000)).toFixed(0)} days/s, pop ${w.people.length}`);
