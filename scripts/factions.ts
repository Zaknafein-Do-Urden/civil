// Headless check of factions, suffrage, checks and social mobility (DESIGN.md §13).
// Usage: npx tsx scripts/factions.ts [--seed demo] [--years 80] [--presets none,chiefdom,feudal,liberal,planned]

import { PRESETS, DIMS, optName } from '../src/core/rules';
import { createWorld, runDays } from '../src/core/sim';
import { personById } from '../src/core/person';
import { platformText } from '../src/core/factions';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const seed = arg('seed', 'demo');
const years = Number(arg('years', '80'));
const presets = arg('presets', 'none,chiefdom,feudal,liberal,planned').split(',');
const pct = (x: number) => (x < 0 ? '—' : `${Math.round(x * 100)}%`);

for (const id of presets) {
  const preset = PRESETS.find((p) => p.id === id)!;
  const t0 = Date.now();
  const w = createWorld({ seed, culture: preset.culture, npcCount: 0 });
  runDays(w, years * 360);
  const st = w.stats;
  console.log(`\n== ${preset.name} (${Date.now() - t0} ms) 人口 ${w.people.length}`);
  for (const y of [20, 40, 60, 80, 120, 160, 200]) {
    const s = st[y - 1];
    if (s) console.log(`  ${y}年 代际相关 ${s.mobility.toFixed(2)} 子承父业 ${pct(s.occInherit)} 底层上升 ${pct(s.upward)} 派系 ${s.factions} 合法性 ${s.legitimacy.toFixed(2)} 基尼 ${s.gini.toFixed(2)}`);
  }
  console.log(`  制度 ${DIMS.map((d, i) => `${d.name}:${optName(d.id, w.polity.institutions[i])}${w.polity.active[i] ? '' : '(休眠)'}`).join(' ')}`);
  for (const f of w.polity.factions) {
    const l = personById(w, f.leaderId);
    console.log(`  · ${f.name}［${f.basis}］ ${f.size}人 实力${pct(f.power)} 得票${pct(f.votes)} 领袖${l?.name ?? '?'} ${platformText(w, f)}`);
  }
  const kinds = ['改革', '改革被否决', '罢免', '政变', '新首领', '新派系', '革命', '起义'];
  console.log(`  事件 ${kinds.map((k) => `${k}${w.events.filter((e) => e.title.startsWith(k)).length}`).join(' ')}`);
  for (const e of w.events.filter((e) => e.polity === undefined && /改革|罢免|政变|革命/.test(e.title)).slice(-8)) console.log(`    [${Math.floor(e.day / 360) + 1}年] ${e.title}：${e.text}`);
}
