// Monthly trace of the first years, for calibration.
import { PRESETS } from '../src/core/rules';
import { createWorld, step } from '../src/core/sim';
import { OCC_NAMES } from '../src/core/types';
import { TECH_INDEX } from '../src/core/tech';

const preset = PRESETS.find((p) => p.id === (process.argv[2] ?? 'primitive'))!;
const months = Number(process.argv[3] ?? 36);
const every = Number(process.argv[5] ?? 1);
const w = createWorld({ seed: process.argv[4] ?? 'demo', culture: preset.culture });
// usage: debug.ts <preset> <months> <seed> <every> [bands|-] [grant,techs]
for (const id of (process.argv[7] ?? '').split(',').filter(Boolean)) w.tech.known[TECH_INDEX[id]] = true;
const t = w.map.tiles[w.settlements[0].tile];
console.log(`start tile temp ${t.temp.toFixed(1)} rain ${t.rain.toFixed(2)} ${t.terrain} bands ${w.settlements.length}`);
for (let m = 0; m < months; m++) {
  for (let d = 0; d < 30; d++) step(w);
  if ((m + 1) % every) continue;
  const occ = new Array(9).fill(0);
  const occH = new Array(9).fill(0);
  let food = 0, hunger = 0, health = 0, hours = 0, workers = 0, rep = 0, low = 0, out = 0;
  for (const p of w.people) {
    if (p.occ >= 0) { occ[p.occ]++; occH[p.occ] += p.avgHours; hours += p.avgHours; workers++; rep += p.reputation; if (p.reputation < w.params.exileRep) low++; }
    if (p.outsider) out++;
    food += p.food; hunger += p.hunger; health += p.health;
  }
  let pool = 0, plants = 0, pcap = 0, game = 0, gcap = 0;
  for (const s of w.settlements) { if (!s.alive) continue; pool += s.food; for (const id of s.territory) { const tt = w.map.tiles[id]; plants += tt.plants; pcap += tt.plantsCap; game += tt.game; gcap += tt.gameCap; } }
  const n = w.people.length;
  const lm = w.lastMonth;
  console.log(`m${m + 1} pop ${n} prod/cap ${(lm.foodProduced / lm.personDays).toFixed(2)} cold ${(lm.coldSum / lm.personDays).toFixed(2)} hunger ${(hunger / n).toFixed(2)} health ${(health / n).toFixed(2)} hrs ${(hours / Math.max(1, workers)).toFixed(1)} rep ${(rep / Math.max(1, workers)).toFixed(2)} low ${low} out ${out} exiled ${w.yearAcc.exiled} techs ${w.tech.known.filter(Boolean).length} pstock ${(food / n).toFixed(1)} pool ${(pool / n).toFixed(1)} plants ${(plants / pcap).toFixed(2)} game ${(game / gcap).toFixed(2)} | ${occ.map((c, i) => `${OCC_NAMES[i]}${c}${c ? '/' + (occH[i] / c).toFixed(1) + 'h' : ''}`).join(' ')}`);
}

if (process.argv[6] === 'bands') {
  for (const s of w.settlements) {
    if (!s.alive) continue;
    const ps = w.people.filter((p) => p.settlement === s.id);
    const ws = ps.filter((p) => p.occ >= 0);
    const avg = (f: (p: (typeof ps)[number]) => number, xs = ps) => (xs.reduce((a, p) => a + f(p), 0) / Math.max(1, xs.length)).toFixed(2);
    console.log(`${s.name} pop ${ps.length} pool/cap ${(s.food / Math.max(1, ps.length)).toFixed(0)} hrs ${avg((p) => p.avgHours, ws)} hunger ${avg((p) => p.hunger)} health ${avg((p) => p.health)} cold ${avg((p) => p.cold)} clothes ${avg((p) => p.clothesCond)} tools ${avg((p) => p.toolCond)} rep ${avg((p) => p.reputation, ws)} pstore ${avg((p) => p.food)} farmers ${ps.filter((p) => p.occ === 5).length} plots ${s.territory.reduce((a, id) => a + w.map.tiles[id].plots, 0).toFixed(0)}/${s.territory.reduce((a, id) => a + w.map.tiles[id].maxPlots, 0)} farmHrs ${avg((p) => p.avgHours, ps.filter((p) => p.occ === 5))}`);
  }
}
