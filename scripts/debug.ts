// Monthly trace of the first years, for calibration.
import { PRESETS } from '../src/core/rules';
import { createWorld, step } from '../src/core/sim';
import { OCC_NAMES } from '../src/core/types';

const preset = PRESETS.find((p) => p.id === (process.argv[2] ?? 'primitive'))!;
const months = Number(process.argv[3] ?? 36);
const w = createWorld({ seed: process.argv[4] ?? 'demo', culture: preset.culture });
const t = w.map.tiles[w.settlements[0].tile];
console.log(`start tile temp ${t.temp.toFixed(1)} rain ${t.rain.toFixed(2)} ${t.terrain} bands ${w.settlements.length}`);
for (let m = 0; m < months; m++) {
  for (let d = 0; d < 30; d++) step(w);
  const occ = new Array(9).fill(0);
  let food = 0, hunger = 0, health = 0, effort = 0;
  for (const p of w.people) { if (p.occ >= 0) occ[p.occ]++; food += p.food; hunger += p.hunger; health += p.health; effort += p.effort; }
  let pool = 0, plants = 0, pcap = 0, game = 0, gcap = 0;
  for (const s of w.settlements) { if (!s.alive) continue; pool += s.food; for (const id of s.territory) { const tt = w.map.tiles[id]; plants += tt.plants; pcap += tt.plantsCap; game += tt.game; gcap += tt.gameCap; } }
  const n = w.people.length;
  const lm = w.lastMonth;
  console.log(`m${m + 1} pop ${n} prod/cap ${(lm.foodProduced / lm.personDays).toFixed(2)} cold ${(lm.coldSum / lm.personDays).toFixed(2)} hunger ${(hunger / n).toFixed(2)} health ${(health / n).toFixed(2)} eff ${(effort / n).toFixed(2)} pstock ${(food / n).toFixed(1)} pool ${(pool / n).toFixed(1)} plants ${(plants / pcap).toFixed(2)} game ${(game / gcap).toFixed(2)} | ${occ.map((c, i) => OCC_NAMES[i] + c).join(' ')}`);
}
