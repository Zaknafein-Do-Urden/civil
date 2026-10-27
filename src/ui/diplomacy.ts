// Diplomacy tab (DESIGN.md §12.7): every polity, relations, wars, and the player's war/peace current.

import { DIMS, optName } from '../core/rules';
import { personById } from '../core/person';
import { formatDate } from '../core/events';
import { ERAS } from '../core/tech';
import { PLAYER, allPolities, peopleOf, polityColor, scopeOf } from '../core/nations';
import { GOAL_NAMES, STATUS_NAMES, relation, warOutlook } from '../core/war';
import type { Polity, World } from '../core/types';
import { esc, pct } from './dom';
import type { Tab, Ui } from './panels';

let selected = PLAYER;

const dot = (p: Polity) => `<span style="color:${polityColor(p)}">■</span>`;
const pname = (w: World, id: number) => {
  const p = allPolities(w)[id];
  return `${dot(p)} <a class="link" data-polity="${id}">${esc(p.name)}</a>${p.alive ? '' : '<span class="muted">（已灭亡）</span>'}`;
};

export const diplomacy: Tab = {
  id: 'diplomacy',
  name: '外交',
  mount(el, ui) {
    el.innerHTML = `<div id="dip">
      <p class="muted small">各部落都按同一套规则模拟。宣战、议和、结盟由各自的制度决定（首领独断、议事会或大会按权力加权表决）。</p>
      <div id="dip-mood"></div>
      <div class="field-row"><button id="dip-hawk">推动主战思潮</button><button id="dip-dove">推动主和思潮</button></div>
      <h4>各政体</h4><div id="dip-list"></div>
      <div id="dip-detail"></div>
      <h4>战争</h4><div id="dip-wars"></div></div>`;
    const root = el.querySelector('#dip') as HTMLElement;
    root.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-polity],[data-focus]');
      if (!t) return;
      if (t.dataset.polity !== undefined) {
        selected = +t.dataset.polity;
        diplomacy.update(el, ui);
      } else if (t.dataset.focus !== undefined) {
        // the document-level handler then switches to the tab named by data-tab
        ui.focus = +t.dataset.focus;
      }
    });
    (el.querySelector('#dip-hawk') as HTMLButtonElement).onclick = () => {
      ui.issue({ day: ui.world.day, type: 'warMood', value: 0.4 });
      ui.toast('主战思潮将在下一天开始传播');
    };
    (el.querySelector('#dip-dove') as HTMLButtonElement).onclick = () => {
      ui.issue({ day: ui.world.day, type: 'warMood', value: -0.4 });
      ui.toast('主和思潮将在下一天开始传播');
    };
  },
  update(el, ui) {
    const w = ui.world;
    const pols = allPolities(w);
    if (!pols[selected]) selected = PLAYER;
    const mood = w.polity.warMood;
    el.querySelector('#dip-mood')!.innerHTML = `<div class="small">本部落的战争思潮：<b>${mood > 0.15 ? '主战' : mood < -0.15 ? '主和' : '平和'}</b>（${mood.toFixed(2)}）。它计入每个人的主战度，伤亡会让它下降，每年也会自然消退。</div>`;

    const pop = new Map<number, number>();
    for (const p of w.people) {
      const id = w.settlements[p.settlement].polity;
      pop.set(id, (pop.get(id) ?? 0) + 1);
    }
    const outlook = warOutlook(w);
    const rows = pols.filter((p) => p.alive || p.id === PLAYER).map((p) => {
      const rel = p.id === PLAYER ? undefined : relation(w, PLAYER, p.id);
      const l = personById(w, p.leaderId);
      const toMe = outlook.find((o) => o.from === p.id && o.to === PLAYER);
      return `<tr class="click" data-polity="${p.id}"><td>${dot(p)} ${esc(p.name)}${p.id === PLAYER ? ' <span class="muted">（你）</span>' : ''}</td>
        <td>${pop.get(p.id) ?? 0}</td><td>${w.settlements.filter((s) => s.alive && s.polity === p.id).length}</td>
        <td>${l ? esc(l.name) : '—'}</td>
        <td>${rel ? STATUS_NAMES[rel.status] : '—'}</td><td>${rel && rel.status !== 'none' ? rel.opinion.toFixed(2) : '—'}</td>
        <td>${toMe ? pct(toMe.support) : '—'}</td></tr>`;
    }).join('');
    el.querySelector('#dip-list')!.innerHTML = `<table class="list"><tr><th>政体</th><th>人口</th><th>聚落</th><th>首领</th><th>与你</th><th>好感</th><th>对你主战</th></tr>${rows}</table>`;

    // detail of the selected polity
    const p = pols[selected];
    const sc = scopeOf(w, p.id);
    const people = peopleOf(w, p.id);
    const last = sc.stats[sc.stats.length - 1];
    const rels = w.relations.filter((r) => r.a === p.id || r.b === p.id).map((r) => {
      const other = r.a === p.id ? r.b : r.a;
      const mine = r.a === p.id ? r.grudgeA : r.grudgeB;
      const o = outlook.find((x) => x.from === p.id && x.to === other);
      const trib = r.status === 'tribute' ? (r.tributary === p.id ? '（我方纳贡）' : '（对方纳贡）') : '';
      const flow = r.status === 'none' ? '<td>—</td><td>—</td>' :
        `<td title="今年至今 ${r.tradeAcc.toFixed(0)}">${r.trade.toFixed(0)}</td><td title="今年至今：通婚 ${r.marriagesAcc}，移民 ${r.migrantsAcc}">${r.marriages} / ${r.migrants}</td>`;
      return `<tr><td>${pname(w, other)}</td><td>${STATUS_NAMES[r.status]}${trib}</td>
        <td>${r.status === 'none' ? '—' : r.opinion.toFixed(2)}</td>${flow}<td>${r.status === 'none' ? '—' : r.ties.toFixed(2)}</td>
        <td>${r.status === 'none' ? '—' : r.friction.toFixed(2)}</td><td>${mine.toFixed(2)}</td><td>${o ? pct(o.support) : '—'}</td></tr>`;
    }).join('');
    const me = outlook.find((o) => o.from === p.id);
    el.querySelector('#dip-detail')!.innerHTML = `<h4>${dot(p)} ${esc(p.name)}${p.alive ? '' : '（已灭亡）'}</h4>
      <div class="kpis">
        <div class="kpi"><div class="k">人口</div><div class="v">${people.length}</div></div>
        <div class="kpi"><div class="k">时代</div><div class="v small">${ERAS[sc.era]}</div></div>
        <div class="kpi"><div class="k">合法性</div><div class="v">${pct(p.legitimacy)}</div></div>
        <div class="kpi"><div class="k">已知科技</div><div class="v">${sc.tech.known.filter(Boolean).length}</div></div>
        <div class="kpi"><div class="k">军力</div><div class="v">${me ? me.strength.toFixed(0) : '—'}</div></div>
        <div class="kpi"><div class="k">战争思潮</div><div class="v">${p.warMood.toFixed(2)}</div></div>
        <div class="kpi"><div class="k">铜 / 锡供应</div><div class="v small">${metal(p.metals.copper, p.imports.copper)} / ${metal(p.metals.tin, p.imports.tin)}</div></div>
      </div>
      ${last ? `<div class="small muted">去年：出生 ${last.births}，死亡 ${last.deaths}，饿死冻死 ${last.starved}；人均产粮 ${last.foodPerCap.toFixed(2)}；基尼 ${last.gini.toFixed(2)}</div>` : ''}
      <div class="small" style="margin:6px 0">${DIMS.map((d, i) => `${d.name}：<b>${esc(optName(d.id, p.institutions[i]))}</b>`).join('　')}</div>
      ${p.alive ? `<button data-tab="overview" data-focus="${p.id}">在其他页面查看${p.id === PLAYER ? '本部落' : '此政体'}（概览、制度、人物、科技、诊断）</button>` : ''}
      <h4>与各国关系</h4>
      <table class="list"><tr><th>对方</th><th>状态</th><th>好感</th><th>贸易额/年</th><th>通婚 / 移民</th><th>往来</th><th>边界摩擦</th><th>积怨</th><th>主战度</th></tr>${rels}</table>
      <p class="muted small">贸易额是去年边境集市上双向成交的货值（食物当量），通婚与移民是去年跨国嫁娶和投奔的人数（鼠标悬停看今年至今）。往来由这些真实的流动决定；好感由文化相似度、往来、边界摩擦和积怨决定；主战度是本国按权力加权的开战意愿，超过 50% 就可能宣战。</p>`;

    const wars = [...w.wars].reverse().slice(0, 30).map((x) => {
      const yrs = ((x.end < 0 ? w.day : x.end) - x.start) / 360;
      return `<div class="event ${x.end < 0 ? 'major' : ''}"><div class="when">${formatDate(x.start)}${x.end < 0 ? ' 起，进行中' : ' — ' + formatDate(x.end)}（${yrs.toFixed(1)} 年）</div>
        <div class="title">${pname(w, x.attacker)} → ${pname(w, x.defender)} · ${GOAL_NAMES[x.goal]}</div>
        <div class="small">行动 ${x.actions} 次；阵亡 ${x.deaths[0]} : ${x.deaths[1]}；征服聚落 ${x.conquests[0]} : ${x.conquests[1]}；掠粮 ${x.loot[0].toFixed(0)} : ${x.loot[1].toFixed(0)}</div>
        ${x.outcome ? `<div class="small muted">${esc(x.outcome)}</div>` : ''}</div>`;
    }).join('');
    el.querySelector('#dip-wars')!.innerHTML = wars || '<p class="muted">尚无战争</p>';
  },
};

function metal(supply: number, imported: number): string {
  if (supply >= 1) return '自产';
  return imported > 0.01 ? `进口 ${pct(imported)}` : '无';
}

export function focusBanner(ui: Ui): string {
  if (ui.focus === PLAYER) return '';
  const p = allPolities(ui.world)[ui.focus];
  return `正在查看 ${dot(p)} <b>${esc(p.name)}</b>（NPC 政体） · <a class="link" data-tab="diplomacy" data-unfocus="1">返回本部落</a>`;
}
