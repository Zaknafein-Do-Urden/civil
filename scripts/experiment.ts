// Headless batch run: compare presets over the same seed and export yearly stats as CSV.
// Usage: npm run experiment -- --seed demo --years 300 --presets primitive,liberal,planned [--out results.csv]

import { writeFileSync } from 'node:fs';
import { PRESETS, DIMS, optName } from '../src/core/rules';
import { createWorld, runDays } from '../src/core/sim';
import { ERAS, TECHS } from '../src/core/tech';
import { OCC_NAMES } from '../src/core/types';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const seed = arg('seed', 'demo');
const years = Number(arg('years', '200'));
const presets = arg('presets', PRESETS.map((p) => p.id).join(',')).split(',');
const out = arg('out', '');

const header = ['preset', 'year', 'pop', 'births', 'deaths', 'starved', 'foodPerCap', 'health', 'happiness', 'grievance', 'gini', 'legitimacy', 'techs', 'settlements', 'effort', ...OCC_NAMES.map((n) => `occ_${n}`)];
const rows: string[] = [header.join(',')];

for (const id of presets) {
  const preset = PRESETS.find((p) => p.id === id);
  if (!preset) {
    console.error(`unknown preset ${id}`);
    continue;
  }
  const t0 = Date.now();
  const world = createWorld({ seed, culture: preset.culture });
  runDays(world, years * 360);
  const ms = Date.now() - t0;
  for (const s of world.stats) {
    rows.push([id, s.year, s.pop, s.births, s.deaths, s.starved, s.foodPerCap.toFixed(3), s.health.toFixed(3), s.happiness.toFixed(3), s.grievance.toFixed(3), s.gini.toFixed(3), s.legitimacy.toFixed(3), s.techs, s.settlements, s.effort.toFixed(3), ...s.occ].join(','));
  }
  const last = world.stats[world.stats.length - 1];
  const known = TECHS.filter((_, i) => world.tech.known[i] && TECHS[i].cost > 0).map((t) => t.name);
  console.log(`\n== ${preset.name} (${ms} ms, ${((years * 360) / (ms / 1000)).toFixed(0)} days/s)`);
  console.log(`  人口 ${last?.pop}  聚落 ${last?.settlements}  ${ERAS[world.era]}  基尼 ${last?.gini.toFixed(2)}  合法性 ${last?.legitimacy.toFixed(2)}  努力 ${last?.effort.toFixed(2)}  人均产粮 ${last?.foodPerCap.toFixed(2)}`);
  console.log(`  职业 ${last?.occ.map((n, i) => `${OCC_NAMES[i]}${n}`).join(' ')}`);
  console.log(`  科技 ${known.join('、') || '无'}`);
  console.log(`  制度 ${DIMS.map((d, i) => `${d.name}:${optName(d.id, world.polity.institutions[i])}`).join(' ')}`);
  const major = world.events.filter((e) => e.major);
  console.log(`  大事件 ${major.length} 件：${major.slice(-8).map((e) => `[${Math.floor(e.day / 360) + 1}年]${e.title}`).join('；')}`);
}

if (out) {
  writeFileSync(out, rows.join('\n'));
  console.log(`\nwrote ${out}`);
}
