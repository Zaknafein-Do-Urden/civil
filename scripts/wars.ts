// Headless check of multiple polities: population of each, contacts, wars, conquests over time.
// Usage: npx tsx scripts/wars.ts --seed demo --years 200 [--preset liberal] [--npcs 3] [--npc-pop 300]

import { PRESETS, DIMS, optName } from '../src/core/rules';
import { createWorld, runDays } from '../src/core/sim';
import { allPolities, peopleOf } from '../src/core/nations';
import { GOAL_NAMES, STATUS_NAMES, warOutlook } from '../src/core/war';
import { ERAS } from '../src/core/tech';
import { scopeOf } from '../src/core/nations';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const years = Number(arg('years', '200'));
const preset = PRESETS.find((p) => p.id === arg('preset', 'none'))!;
const t0 = Date.now();
const w = createWorld({
  seed: arg('seed', 'demo'), culture: preset.culture,
  npcCount: Number(arg('npcs', '3')), npcPopulation: Number(arg('npc-pop', '300')),
});
const line = () =>
  allPolities(w).map((p) => `${p.name}${p.alive ? '' : '†'}:${peopleOf(w, p.id).length}/${w.settlements.filter((s) => s.alive && s.polity === p.id).length}`).join('  ');
console.log(`year 0  ${line()}`);
const step = Number(arg('every', '20'));
for (let y = step; y <= years; y += step) {
  runDays(w, step * 360);
  const active = w.wars.filter((x) => x.end < 0).length;
  const met = w.relations.filter((r) => r.status !== 'none');
  const sum = (f: (r: (typeof met)[0]) => number) => met.reduce((a, r) => a + f(r), 0);
  console.log(`year ${y}  ${line()}  | wars active ${active}, total ${w.warSeq}`);
  console.log(`   contacts ${met.length}, alliances ${met.filter((r) => r.status === 'alliance').length}, peace ${met.filter((r) => r.status === 'peace').length}; ` +
    `last year: trade ${sum((r) => r.trade).toFixed(0)}, marriages ${sum((r) => r.marriages)}, migrants ${sum((r) => r.migrants)}; mean ties ${(sum((r) => r.ties) / Math.max(1, met.length)).toFixed(2)}, opinion ${(sum((r) => r.opinion) / Math.max(1, met.length)).toFixed(2)}`);
  if (process.argv.includes('--outlook')) {
    for (const o of warOutlook(w)) {
      const m = o.motives;
      console.log(`   ${o.from}->${o.to} 主战${o.support.toFixed(2)} need${m.need.toFixed(2)} land${m.land.toFixed(2)} rev${m.revenge.toFixed(2)} free${m.freedom.toFixed(2)} total${m.total.toFixed(2)} 力${o.strength.toFixed(0)}:${o.enemyStrength.toFixed(0)}`);
    }
    for (const r of w.relations) if (r.status !== 'none') console.log(`   ${r.a}-${r.b} ${STATUS_NAMES[r.status]} 好感${r.opinion.toFixed(2)} 往来${r.ties.toFixed(2)} 贸易${r.trade.toFixed(0)} 通婚${r.marriages} 移民${r.migrants} 摩擦${r.friction.toFixed(2)}`);
  }
}
const ms = Date.now() - t0;
console.log(`\n${((years * 360) / (ms / 1000)).toFixed(0)} days/s, total pop ${w.people.length}`);
for (const p of allPolities(w)) {
  const sc = scopeOf(w, p.id);
  console.log(`${p.name}${p.alive ? '' : '（灭亡）'} ${ERAS[sc.era]} 科技${sc.tech.known.filter(Boolean).length} 合法性${p.legitimacy.toFixed(2)} 制度 ${DIMS.map((d, i) => optName(d.id, p.institutions[i])).join('/')}`);
}
for (const r of w.relations) {
  if (r.status === 'none') continue;
  console.log(`${allPolities(w)[r.a].name}-${allPolities(w)[r.b].name}: ${STATUS_NAMES[r.status]} 好感${r.opinion.toFixed(2)} 往来${r.ties.toFixed(2)} 贸易${r.trade.toFixed(0)} 通婚${r.marriages} 移民${r.migrants} 摩擦${r.friction.toFixed(2)} 积怨${r.grudgeA.toFixed(2)}/${r.grudgeB.toFixed(2)}`);
}
for (const x of w.wars) {
  const n = (id: number) => allPolities(w)[id].name;
  console.log(`[${Math.floor(x.start / 360) + 1}-${x.end < 0 ? '' : Math.floor(x.end / 360) + 1}年] ${n(x.attacker)}→${n(x.defender)} ${GOAL_NAMES[x.goal]} 行动${x.actions} 阵亡${x.deaths.join(':')} 征服${x.conquests.join(':')} 掠粮${x.loot.map((v) => v.toFixed(0)).join(':')} ${x.outcome}`);
}
const kinds = ['互市', '移民', '宣战', '劫掠', '战役', '征服', '议和', '起义', '灭亡', '首次接触', '同盟', '朝贡'];
console.log(kinds.map((k) => `${k}${w.events.filter((e) => e.title.includes(k)).length}`).join(' '));
