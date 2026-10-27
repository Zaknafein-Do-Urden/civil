// Side-panel tabs. Each tab mounts its static controls once and refreshes its dynamic parts.

import { DIMS, optName } from '../core/rules';
import { PARAM_DEFS, DEFAULT_PARAMS } from '../core/params';
import type { Params } from '../core/params';
import { ageYears, personById, topPref } from '../core/person';
import { DOMAIN_NAMES, ENV_NAMES, ERAS, TECHS, envFlags, prereqsMet } from '../core/tech';
import type { Domain } from '../core/tech';
import { foodNeed, wealth } from '../core/economy';
import { diagnose } from '../core/stats';
import { popularSupport, weightedSupport } from '../core/politics';
import { checkingBody, leaderBacking, platformText } from '../core/factions';
import { formatDate } from '../core/events';
import { TERRAIN_NAMES, isLand, travelCosts } from '../core/map';
import { issue } from '../core/sim';
import { decodeTileSnapshot, tileCapacity } from '../core/tiles';
import type { TileSnapshot } from '../core/tiles';
import { has } from '../core/tech';
import { season } from '../core/dmath';
import { DAYS_PER_YEAR, NOCC, OCC, OCC_COLORS, OCC_NAMES } from '../core/types';
import type { Person, World } from '../core/types';
import { bar, esc, mini, pct } from './dom';
import { drawChart } from './chart';
import type { Series } from './chart';
import { settlementColor, stockRatio } from './mapView';
import { PLAYER, polityOf, polityView } from '../core/nations';
import { TIER_NAMES, levyObedience, localRuler, remitShare, tier } from '../core/control';
import { diplomacy } from './diplomacy';

export interface Ui {
  world: World;
  tab: string;
  personId: number;
  settlementId: number;
  tileId: number;
  majorOnly: boolean;
  /** Polity whose overview, institutions, elite and tech the tabs show (0 = the player's). */
  focus: number;
  select(kind: 'person' | 'settlement' | 'tile', id: number): void;
  toast(msg: string): void;
}

export interface Tab {
  id: string;
  name: string;
  mount(el: HTMLElement, ui: Ui): void;
  update(el: HTMLElement, ui: Ui): void;
}

/** The focused polity as if it were the only one. */
const view = (ui: Ui): World => polityView(ui.world, ui.focus);

const personLink = (w: World, id: number): string => {
  const p = personById(w, id);
  if (p) return `<a class="link" data-person="${p.id}">${esc(p.name)}</a>`;
  const n = w.notables.find((x) => x.id === id);
  return n ? `<a class="link" data-person="${id}">${esc(n.name)}</a><span class="muted">（已故）</span>` : '<span class="muted">已故</span>';
};

const settlementLink = (w: World, id: number): string => {
  const s = w.settlements[id];
  return s ? `<a class="link" data-settlement="${id}">${esc(s.name)}</a>` : '';
};

function roleName(p: Person): string {
  if (p.role === 'leader') return '首领';
  if (p.role === 'council') return '长老';
  if (p.role === 'governor') return '镇守';
  if (p.role === 'chief') return '头人';
  if (p.occ === OCC.admin) return '官吏';
  return '';
}

// --- overview ------------------------------------------------------------

const overview: Tab = {
  id: 'overview',
  name: '概览',
  mount(el) {
    el.innerHTML = `<div id="ov-kpis" class="kpis"></div>
      <h4>人口</h4><canvas class="chart" id="ch-pop"></canvas>
      <h4>生活</h4><canvas class="chart" id="ch-life"></canvas>
      <h4>不平等与政治</h4><canvas class="chart" id="ch-pol"></canvas>
      <h4>生产</h4><canvas class="chart" id="ch-prod"></canvas>
      <h4>职业结构</h4><canvas class="chart" id="ch-occ"></canvas>`;
  },
  update(el, ui) {
    const w = view(ui);
    const st = w.stats;
    const last = st[st.length - 1];
    const l = personById(w, w.polity.leaderId);
    const lm = w.lastMonth;
    const tinkers = w.people.filter((p) => p.occ === OCC.tinker).length;
    let griev = 0;
    let hours = 0;
    let workers = 0;
    for (const p of w.people) {
      griev += p.grievance;
      if (p.occ >= 0) {
        hours += p.avgHours;
        workers++;
      }
    }
    const kpi = (k: string, v: string) => `<div class="kpi"><div class="k">${k}</div><div class="v">${v}</div></div>`;
    el.querySelector('#ov-kpis')!.innerHTML = [
      kpi('人口', String(w.people.length)),
      kpi('聚落', String(w.settlements.filter((s) => s.alive).length)),
      kpi('时代', ERAS[w.era]),
      kpi('首领', l ? personLink(w, l.id) : '—'),
      kpi('合法性', pct(w.polity.legitimacy)),
      kpi('平均不满', pct(griev / Math.max(1, w.people.length))),
      kpi('人均日产粮', lm.personDays ? (lm.foodProduced / lm.personDays).toFixed(2) : '—'),
      kpi('平均工时', `${(hours / Math.max(1, workers)).toFixed(1)} 小时/天`),
      kpi('外来者', String(w.people.filter((p) => p.outsider).length)),
      kpi('基尼系数', last ? last.gini.toFixed(2) : '—'),
      kpi('专职研究者', String(tinkers)),
      kpi('官吏', String(w.people.filter((p) => p.occ === OCC.admin).length)),
      kpi('已知科技', String(w.tech.known.filter(Boolean).length)),
    ].join('');
    const step = Math.max(1, Math.ceil(st.length / 400));
    const s = st.filter((_, i) => i % step === 0 || i === st.length - 1);
    const xs = s.map((x) => x.year);
    drawChart(el.querySelector('#ch-pop')!, xs, [
      { name: '人口', color: '#4fb3ff', values: s.map((x) => x.pop) },
    ], { min: 0 });
    drawChart(el.querySelector('#ch-life')!, xs, [
      { name: '健康', color: '#5cd18b', values: s.map((x) => x.health) },
      { name: '幸福', color: '#ffd54a', values: s.map((x) => x.happiness) },
      { name: '不满', color: '#ff6b6b', values: s.map((x) => x.grievance) },
      { name: '闲暇占比', color: '#b39ddb', values: s.map((x) => (x.hours === undefined ? 0 : 1 - x.hours / w.params.maxHours)) },
    ], { min: 0, max: 1 });
    drawChart(el.querySelector('#ch-pol')!, xs, [
      { name: '基尼系数', color: '#ff8a65', values: s.map((x) => x.gini) },
      { name: '合法性', color: '#4fb3ff', values: s.map((x) => x.legitimacy) },
    ], { min: 0, max: 1 });
    drawChart(el.querySelector('#ch-prod')!, xs, [
      { name: '人均日产粮', color: '#f9a825', values: s.map((x) => x.foodPerCap) },
      { name: '饥寒死亡/百人', color: '#ff6b6b', values: s.map((x) => (x.pop ? (x.starved / x.pop) * 100 : 0)) },
      { name: '平均工时', color: '#b39ddb', values: s.map((x) => x.hours ?? 0) },
      { name: '被排挤/千人', color: '#8d98a8', values: s.map((x) => (x.pop ? ((x.exiled ?? 0) / x.pop) * 1000 : 0)) },
    ], { min: 0 });
    drawChart(el.querySelector('#ch-occ')!, xs,
      OCC_NAMES.map((n, i) => ({ name: n, color: OCC_COLORS[i], values: s.map((x) => x.occ[i]) })), { stacked: true });
  },
};

// --- institutions --------------------------------------------------------

const institutions: Tab = {
  id: 'inst',
  name: '制度',
  mount(el, ui) {
    el.innerHTML = `<p class="muted small">黄色为现行制度。每个选项两条支持度：<b>上</b>＝按权力加权（决定改革），<b>下</b>＝全体成年人（决定民心与革命）。</p>
      <div id="inst-list"></div>
      <h3 data-wiki="factions">派系</h3><div id="inst-factions"></div>
      <h3 data-wiki="mobility">社会流动</h3><div id="inst-mobility"></div><canvas class="chart" id="ch-mobility"></canvas>
      <h3>各聚落执行情况</h3><div id="inst-settlements"></div>
      <div id="mv-box"><h3>推动思潮</h3>
      <p class="muted small">让一部分理想主义者开始鼓吹某个选项。其他人会按各自利益决定支持还是反对，结果可能是改革、被否决或引发革命。</p>
      <div class="field-row"><label>维度 <select id="mv-dim">${DIMS.map((d, i) => `<option value="${i}">${d.name}</option>`).join('')}</select></label></div>
      <div class="field-row"><label>主张 <select id="mv-opt"></select></label></div>
      <div class="field-row"><label>理想主义者比例 <input id="mv-str" type="range" min="5" max="50" value="20" /> <span id="mv-str-v">20%</span></label></div>
      <button id="mv-go" class="primary">发起思潮</button></div>`;
    const dimSel = el.querySelector('#mv-dim') as HTMLSelectElement;
    const optSel = el.querySelector('#mv-opt') as HTMLSelectElement;
    const str = el.querySelector('#mv-str') as HTMLInputElement;
    const fillOpts = () => {
      optSel.innerHTML = DIMS[+dimSel.value].options.map((o, i) => `<option value="${i}">${o.name} — ${o.desc}</option>`).join('');
    };
    fillOpts();
    dimSel.onchange = fillOpts;
    str.oninput = () => ((el.querySelector('#mv-str-v') as HTMLElement).textContent = `${str.value}%`);
    (el.querySelector('#mv-go') as HTMLButtonElement).onclick = () => {
      issue(ui.world, { day: ui.world.day, type: 'movement', dim: +dimSel.value, opt: +optSel.value, strength: +str.value / 100 });
      ui.toast('思潮将在下一天开始传播');
    };
  },
  update(el, ui) {
    const w = view(ui);
    (el.querySelector('#mv-box') as HTMLElement).style.display = ui.focus === PLAYER ? '' : 'none';
    const ws = weightedSupport(w);
    const ps = popularSupport(w);
    el.querySelector('#inst-list')!.innerHTML = DIMS.map((d, di) => {
      const cur = w.polity.institutions[di];
      const active = w.polity.active[di];
      return `<div class="inst ${active ? '' : 'dormant'}">
        <div class="inst-head"><span><b>${d.name}</b> <span class="muted small">${d.group}</span></span>
          <span class="cur">${esc(optName(d.id, cur))}${active ? '' : '（休眠）'}</span></div>
        ${d.options.map((o, oi) => `<div class="opt-row ${oi === cur ? 'cur' : ''}"><span>${o.name}</span>
          ${mini(ws[di][oi], oi === cur ? 'var(--accent-2)' : 'var(--accent)')}
          ${mini(ps[di][oi], '#8d98a8')}</div>`).join('')}
      </div>`;
    }).join('');
    const fs = w.polity.factions;
    const unaffiliated = w.people.filter((p) => p.faction < 0 && ageYears(w, p) >= 16).length;
    const hasVotes = fs.some((f) => f.votes > 0);
    const ruling = personById(w, w.polity.leaderId)?.faction ?? -1;
    el.querySelector('#inst-factions')!.innerHTML = fs.length
      ? `<table class="list"><tr><th>派系</th><th>领袖</th><th>成员</th><th>实力</th>${hasVotes ? '<th>得票</th>' : ''}<th>主张</th></tr>${fs.map((f) => `<tr><td>${esc(f.name)}${f.id === ruling ? ' ★' : ''}<div class="muted small">${esc(f.basis)} · ${formatDate(f.founded)}起</div></td><td>${personLink(w, f.leaderId)}</td><td>${f.size}</td><td>${pct(f.power)}</td>${hasVotes ? `<td>${pct(f.votes)}</td>` : ''}<td class="small">${esc(platformText(w, f))}</td></tr>`).join('')}</table>
        <p class="muted small">★ 首领所在派系。实力＝成员在权力加权中所占份额；${unaffiliated} 名成年人不属于任何派系。${checkText(w)}</p>`
      : '<p class="muted small">还没有成形的派系：成年人太少，或者人们的主张和身份差别不大。</p>';
    const last = w.stats[w.stats.length - 1];
    const known = (x: number | undefined) => (x === undefined || x < 0 ? '—' : pct(x));
    el.querySelector('#inst-mobility')!.innerHTML = `<div class="kpis">
      <div class="kpi"><div class="k">代际阶层相关</div><div class="v">${last && last.mobility !== undefined && last.mobility >= 0 ? last.mobility.toFixed(2) : '—'}</div></div>
      <div class="kpi"><div class="k">子承父业</div><div class="v">${known(last?.occInherit)}</div></div>
      <div class="kpi"><div class="k">底层出身升入上层</div><div class="v">${known(last?.upward)}</div></div>
      <div class="kpi"><div class="k">世家贵族</div><div class="v">${pct(w.people.filter((p) => p.noble).length / Math.max(1, w.people.length))}</div></div>
    </div><p class="muted small">30–55 岁成年人现在的地位（财富与官职在成年人中的排位）与其成长时家庭地位的相关系数：0 表示出身无关，1 表示完全由出身决定。开局一代的出身未知，约 15 年后才有数据。</p>`;
    const ms = w.stats.filter((x) => x.mobility !== undefined && x.mobility >= 0);
    drawChart(el.querySelector('#ch-mobility')!, ms.map((x) => x.year), [
      { name: '代际阶层相关', color: '#ff8a65', values: ms.map((x) => x.mobility) },
      { name: '子承父业', color: '#8d98a8', values: ms.map((x) => Math.max(0, x.occInherit)) },
      { name: '底层上升', color: '#5cd18b', values: ms.map((x) => Math.max(0, x.upward)) },
    ], { min: 0, max: 1 });
    const rows = w.settlements.filter((s) => s.alive).map((s) => {
      const diff = DIMS.map((d, di) => (s.practiced[di] !== w.polity.institutions[di] ? `${d.name}:${optName(d.id, s.practiced[di])}` : '')).filter(Boolean);
      return `<tr class="click" data-settlement="${s.id}"><td><span style="color:${settlementColor(s.id)}">●</span> ${esc(s.name)}${s.id === w.polity.capital ? ' ★' : ''}</td><td>${s.pop}</td><td>${s.distance.toFixed(1)}</td><td>${pct(s.enforcement)}</td><td class="small">${diff.length ? esc(diff.join('，')) : '<span class="muted">与国家一致</span>'}</td></tr>`;
    });
    el.querySelector('#inst-settlements')!.innerHTML = `<table class="list"><tr><th>聚落</th><th>人口</th><th>距首都</th><th>执行力</th><th>本地实际做法</th></tr>${rows.join('')}</table>`;
  },
};

/** Who can veto reforms and remove the leader, and how much of that body the leader's faction holds. */
function checkText(w: World): string {
  const body = checkingBody(w);
  if (!body) return '没有制衡：首领的决定无人能否决，罢免只能靠政变。';
  return `改革须经${body.name}多数同意；首领派系在${body.name}中占 ${pct(leaderBacking(w, body.members))}，合法性跌破 40% 且不占多数时可能被罢免。`;
}

// --- settlement ----------------------------------------------------------

const settlement: Tab = {
  id: 'settlement',
  name: '聚落',
  mount() {},
  update(el, ui) {
    const target = ui.world.settlements[ui.settlementId];
    const w = target?.alive ? polityView(ui.world, target.polity) : view(ui);
    const s = w.settlements[ui.settlementId];
    if (!s || !s.alive) {
      const rows = w.settlements.filter((x) => x.alive).sort((a, b) => b.pop - a.pop)
        .map((x) => `<tr class="click" data-settlement="${x.id}"><td><span style="color:${settlementColor(x.id)}">●</span> ${esc(x.name)}${x.id === w.polity.capital ? ' ★' : ''}</td><td>${x.pop}</td><td>${TERRAIN_NAMES[w.map.tiles[x.tile].terrain]}</td><td>${formatDate(x.founded)}</td></tr>`);
      el.innerHTML = `<p class="muted">在地图上点击一个聚落，或从下表选择。</p><table class="list"><tr><th>聚落</th><th>人口</th><th>地形</th><th>建立</th></tr>${rows.join('')}</table>`;
      return;
    }
    const people = w.people.filter((p) => p.settlement === s.id);
    const tile = w.map.tiles[s.tile];
    let pl = 0, pc = 0, gm = 0, gc = 0, fs = 0, fc = 0, plots = 0, maxPlots = 0;
    for (const id of s.territory) {
      const t = w.map.tiles[id];
      pl += t.plants; pc += t.plantsCap; gm += t.game; gc += t.gameCap; fs += t.fish; fc += t.fishCap; plots += t.plots; maxPlots += t.maxPlots;
    }
    let need = 0, hunger = 0, happy = 0, wsum = 0;
    const occ = new Array<number>(NOCC).fill(0);
    for (const p of people) {
      need += foodNeed(w, p);
      hunger += p.hunger;
      happy += p.happiness;
      wsum += wealth(p, s);
      if (p.occ >= 0) occ[p.occ]++;
    }
    const n = Math.max(1, people.length);
    const ethnic = new Map<number, number>();
    for (const p of people) ethnic.set(p.ethnicity, (ethnic.get(p.ethnicity) ?? 0) + 1);
    const ethnicText = [...ethnic].sort((a, b) => b[1] - a[1]).map(([e, c]) => `${esc(polityOf(w, e).name)} ${pct(c / n)}`).join('、');
    const sorted = [...people].sort((a, b) => (a.occ - b.occ) || (b.prestige - a.prestige));
    const dots = sorted.map((p) => {
      const child = ageYears(w, p) < 16;
      const color = p.occ >= 0 ? OCC_COLORS[p.occ] : '#555';
      const elite = p.role !== 'none' ? 'elite' : '';
      return `<span class="dot ${child ? 'child' : ''} ${elite}" style="background:${color}" data-person="${p.id}" title="${esc(p.name)} ${Math.floor(ageYears(w, p))}岁 ${p.occ >= 0 ? OCC_NAMES[p.occ] : child ? '儿童' : '老人'}"></span>`;
    }).join('');
    const diff = DIMS.map((d, di) => `<div class="small">${d.name}：<b>${esc(optName(d.id, s.practiced[di]))}</b>${s.practiced[di] !== w.polity.institutions[di] ? ' <span style="color:var(--warn)">（与国家不同）</span>' : ''}</div>`).join('');
    el.innerHTML = `<div class="person-head"><h3><span style="color:${settlementColor(s.id)}">●</span> ${esc(s.name)}${s.id === w.polity.capital ? ' ★首都' : ''} <span class="small muted">${esc(w.polity.name)}${s.origin !== s.polity ? ' · 被征服' : ''}</span></h3><a class="link" data-settlement="-1">全部聚落</a></div>
      <div class="muted small">建于${formatDate(s.founded)} · ${TERRAIN_NAMES[tile.terrain]} · 年均 ${tile.temp.toFixed(0)}°C · ${tile.river ? '河畔' : ''}${tile.coast ? '海滨' : ''}</div>
      <div class="muted small">民族：${ethnicText || '—'}</div>
      <div class="muted small" data-wiki="control">管辖：<b>${TIER_NAMES[tier(w, s)]}</b>（执行力 ${pct(s.enforcement)}，税收上交中央 ${pct(remitShare(w, s))}，征兵应召 ${pct(levyObedience(w, s))}）${localRuler(w, s) ? ` · ${roleName(localRuler(w, s)!)}：${personLink(w, localRuler(w, s)!.id)}` : s.origin !== s.polity ? ' · 镇守暂缺' : ''}${s.skimmed > 0.5 ? ` · 去年截留 ${s.skimmed.toFixed(0)} 食物` : ''}</div>
      ${s.epidemic > 0 ? `<div class="small" style="color:var(--warn)">${esc(s.epiName)}正在流行，已有 ${s.epiDeaths} 人病死</div>` : s.immunity > 0.3 ? `<div class="muted small">多数人得过上一场疫病，暂时免疫（${pct(s.immunity)}）</div>` : ''}
      <div class="kpis" style="margin-top:6px">
        <div class="kpi"><div class="k">人口</div><div class="v">${people.length}</div></div>
        <div class="kpi"><div class="k">公共存粮</div><div class="v">${(s.food / Math.max(1, need)).toFixed(0)} 天</div></div>
        <div class="kpi"><div class="k">执行力</div><div class="v">${pct(s.enforcement)}</div></div>
        <div class="kpi"><div class="k">平均饥饿</div><div class="v">${pct(hunger / n)}</div></div>
        <div class="kpi"><div class="k">平均幸福</div><div class="v">${pct(happy / n)}</div></div>
        <div class="kpi"><div class="k">人均财富</div><div class="v">${(wsum / n).toFixed(0)}</div></div>
      </div>
      <h4>环境</h4>
      ${bar('野生植物', pl / Math.max(1, pc), '#7cb342')}${bar('猎物', gm / Math.max(1, gc), '#c0632b')}${fc > 0 ? bar('鱼', fs / fc, '#2e86c1') : ''}${maxPlots > 0 ? bar('耕地', plots / maxPlots, '#f9a825', `${plots.toFixed(0)}/${maxPlots}`) : ''}
      <div class="muted small">价格（以食物计）：工具 ${s.toolPrice.toFixed(1)}，衣物 ${s.clothesPrice.toFixed(1)}</div>
      <h4>居民（${people.length}）</h4>
      <div class="occ-legend">${OCC_NAMES.map((o, i) => `<span><i style="background:${OCC_COLORS[i]}"></i>${o} ${occ[i]}</span>`).join('')}</div>
      <div class="dots">${dots}</div>
      <h4>实际实行的制度</h4>${diff}`;
  },
};

// --- tile ----------------------------------------------------------------

const SEASON_NAMES = ['冬', '冬', '春', '春', '春', '夏', '夏', '夏', '秋', '秋', '秋', '冬'];

const snapCache = new Map<string, TileSnapshot>();
function snapshot(w: World, data: string): TileSnapshot {
  let s = snapCache.get(data);
  if (!s) {
    if (snapCache.size > 150) snapCache.clear();
    s = decodeTileSnapshot(w.map, data);
    snapCache.set(data, s);
  }
  return s;
}

let travelCache: { key: string; costs: number[] } | undefined;
function capitalCosts(w: World): number[] | undefined {
  const cap = w.settlements[w.polity.capital];
  if (!cap?.alive) return undefined;
  const tech = { boats: has(w, 'boats'), wheel: has(w, 'wheel'), sailing: has(w, 'sailing') };
  const key = `${w.seed}|${cap.tile}|${tech.boats}${tech.wheel}${tech.sailing}`;
  if (travelCache?.key !== key) travelCache = { key, costs: travelCosts(w.map, w.map.tiles[cap.tile], tech) };
  return travelCache.costs;
}

function delta(now: number, before: number | undefined): string {
  if (before === undefined || Number.isNaN(before)) return '';
  const d = now - before;
  if (Math.abs(d) < 0.005) return '<span class="tile-delta muted">持平</span>';
  return `<span class="tile-delta ${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : ''}${(d * 100).toFixed(0)}%</span>`;
}

const yesNo = (v: boolean) => (v ? '有' : '<span class="muted">无</span>');

const tileTab: Tab = {
  id: 'tile',
  name: '地块',
  mount(el) {
    el.innerHTML = `<div id="tl-info"></div>
      <div id="tl-hist"><h4>资源历史（近 100 年，每年末记录一次）</h4><canvas class="chart" id="ch-tile"></canvas><div id="tl-owners" class="small"></div></div>`;
  },
  update(el, ui) {
    const w = ui.world;
    const t = w.map.tiles[ui.tileId];
    const info = el.querySelector('#tl-info')!;
    const hist = el.querySelector('#tl-hist') as HTMLElement;
    if (!t) {
      info.innerHTML = '<p class="muted">在地图上点击任何地块（聚落中心除外）查看它的环境、资源和历史。</p>';
      hist.style.display = 'none';
      return;
    }
    const h = w.tileHistory;
    // reference snapshot: the last year-end strictly before today ("较上年末")
    let ref = -1;
    for (let i = h.days.length - 1; i >= 0; i--) {
      if (h.days[i] < w.day) {
        ref = i;
        break;
      }
    }
    const prev = ref >= 0 ? snapshot(w, h.data[ref]) : undefined;
    const seasonal = t.temp + 12 * season(w.day % DAYS_PER_YEAR);
    const month = Math.floor((w.day % DAYS_PER_YEAR) / 30);
    const water = !isLand(t);
    const head = `<div class="person-head"><h3>${TERRAIN_NAMES[t.terrain]} <span class="muted small">（${t.col}, ${t.row}）</span></h3><a class="link" data-tile="-1">关闭</a></div>
      <div class="muted small">海拔 ${water ? '—' : (t.elev * 3000).toFixed(0) + ' 米'} · 年均 ${t.temp.toFixed(1)}°C · 当前（${SEASON_NAMES[month]}）${seasonal.toFixed(1)}°C · 降水 ${pct(t.rain)}${t.river ? ' · 河流' : ''}${t.coast ? ' · 海岸' : ''}</div>`;
    if (t.terrain === 'ocean') {
      info.innerHTML = `${head}<p class="muted small">海洋本身不记资源：沿海渔获计在相邻的海岸陆地格上。</p>`;
      hist.style.display = 'none';
      return;
    }

    const res = (name: string, key: 'plants' | 'game' | 'fish', color: string) => {
      const cap = t[(key + 'Cap') as 'plantsCap' | 'gameCap' | 'fishCap'];
      if (cap <= 0) return '';
      const r = t[key] / cap;
      return `<tr><td>${name}</td><td>${mini(r, color)}</td><td class="small">${t[key].toFixed(0)} / ${cap.toFixed(0)}</td><td>${delta(r, prev?.[key][t.id])}</td></tr>`;
    };
    const resRows = res('野生植物', 'plants', '#7cb342') + res('猎物', 'game', '#c0632b') + res('鱼', 'fish', '#2e86c1');
    const plotsRow = t.maxPlots > 0
      ? `<tr><td>耕地</td><td>${mini(t.plots / t.maxPlots, '#f9a825')}</td><td class="small">${t.plots.toFixed(1)} / ${t.maxPlots} 块</td><td>${prev ? delta(t.plots / t.maxPlots, prev.plots[t.id] / t.maxPlots) : ''}</td></tr>`
      : '';
    const wildShare = t.maxPlots > 0 ? 1 - (t.plots / t.maxPlots) * 0.7 : 1;

    const owner = t.owner >= 0 ? w.settlements[t.owner] : undefined;
    const costs = capitalCosts(w);
    const dist = costs?.[t.id];
    const cap = water ? undefined : tileCapacity(w, t);
    const ratio = stockRatio(t);

    info.innerHTML = `${head}
      <div class="kpis" style="margin-top:6px">
        <div class="kpi"><div class="k">资源存量</div><div class="v">${Number.isNaN(ratio) ? '—' : pct(ratio)}</div></div>
        <div class="kpi"><div class="k">归属</div><div class="v">${owner ? settlementLink(w, owner.id) : '<span class="muted">无主</span>'}</div></div>
        <div class="kpi"><div class="k">可持续承载</div><div class="v">${cap ? cap.people.toFixed(1) + ' 人' : '—'}</div></div>
      </div>
      <h4>野生资源${prev ? ' <span class="muted small">（右列：较上年末）</span>' : ''}</h4>
      ${resRows || plotsRow ? `<table class="list">${resRows}${plotsRow}</table>` : '<p class="muted small">这里几乎不产出任何东西。</p>'}
      ${wildShare < 1 ? `<div class="muted small">农田挤占了野生动植物：当前上限只有原始的 ${pct(wildShare)}。</div>` : ''}
      ${water ? '' : `<h4>土地与矿产</h4>
      <div class="grid2 small">
        <div>肥力：<b>${pct(t.fertility)}</b></div><div>可开垦：<b>${t.maxPlots}</b> 块</div>
        <div>石料：<b>${t.stone >= 1 ? '丰富' : t.stone >= 0.5 ? '一般' : '稀少'}</b></div><div>黏土：${yesNo(t.clay)}</div>
        <div>铜矿：${yesNo(t.copper)}</div><div>锡矿：${yesNo(t.tin)}</div>
        <div>野生谷物：${yesNo(t.grain)}</div><div>可驯化动物：${yesNo(t.animals)}</div>
      </div>`}
      <h4>人与政治</h4>
      <div class="small">所属聚落：${owner ? `${settlementLink(w, owner.id)}（${owner.pop} 人，领地 ${owner.territory.length} 格）` : '<span class="muted">无主之地</span>'}</div>
      <div class="small">到首都通行距离：${dist === undefined ? '—' : Number.isFinite(dist) ? dist.toFixed(1) : '<span class="muted">无法到达</span>'}</div>
      <div class="small">执行力：${owner?.alive ? pct(owner.enforcement) : '<span class="muted">无人居住，不受管辖</span>'}</div>
      ${cap ? `<h4>承载力估算（按当前科技）</h4>
      <div class="small">野生资源最大可持续产量 ≈ <b>${cap.wild.toFixed(1)}</b> 食物/天${has(w, 'fishing') || t.fishCap <= 0 ? '' : '（尚不会捕鱼，鱼未计入）'}</div>
      ${cap.agriculture && t.maxPlots > 0 ? `<div class="small">全部开垦耕作 ≈ <b>${cap.farmed.toFixed(1)}</b> 食物/天（含剩余的野生资源）</div>` : ''}
      <div class="small">可持续养活约 <b>${cap.people.toFixed(1)}</b> 人。<span class="muted">这是理论上限：未计劳力、工具与努力；资源被吃到上限的约 80% 以下，采集效率就开始下降。</span></div>` : ''}`;

    // history
    hist.style.display = '';
    const snaps = h.data.map((d) => snapshot(w, d));
    const xs = h.days.map((d) => d / DAYS_PER_YEAR);
    const series: Series[] = [];
    if (t.plantsCap > 0) series.push({ name: '植物', color: '#7cb342', values: snaps.map((x) => x.plants[t.id]) });
    if (t.gameCap > 0) series.push({ name: '猎物', color: '#c0632b', values: snaps.map((x) => x.game[t.id]) });
    if (t.fishCap > 0) series.push({ name: '鱼', color: '#4fb3ff', values: snaps.map((x) => x.fish[t.id]) });
    if (t.maxPlots > 0) series.push({ name: '耕地占比', color: '#f9a825', values: snaps.map((x) => x.plots[t.id] / t.maxPlots) });
    const canvas = el.querySelector('#ch-tile') as HTMLCanvasElement;
    canvas.style.display = snaps.length && series.length ? '' : 'none';
    if (snaps.length && series.length) drawChart(canvas, xs, series, { min: 0, max: 1 });
    const changes: string[] = [];
    let last: number | undefined;
    snaps.forEach((x, i) => {
      const o = x.owner[t.id];
      if (o === last) return;
      const name = o >= 0 ? settlementLink(w, o) : '<span class="muted">无主</span>';
      changes.push(`<div><span class="muted">第${h.days[i] / DAYS_PER_YEAR}年末</span> ${last === undefined ? '' : '变为 '}${name}</div>`);
      last = o;
    });
    el.querySelector('#tl-owners')!.innerHTML = snaps.length
      ? `<h4>归属变迁</h4>${changes.join('')}`
      : '<p class="muted small">还没有记录：每年年末记录一次。</p>';
  },
};

// --- people --------------------------------------------------------------

const people: Tab = {
  id: 'people',
  name: '人物',
  mount() {},
  update(el, ui) {
    let w = ui.world;
    const p = personById(w, ui.personId);
    if (p) {
      el.innerHTML = personDetail(polityView(w, w.settlements[p.settlement].polity), p);
      return;
    }
    const dead = w.notables.find((x) => x.id === ui.personId);
    if (dead) {
      el.innerHTML = `<div class="person-head"><h3>${esc(dead.name)} <span class="muted small">（已故）</span></h3><a class="link" data-person="-1">返回</a></div>
        <div class="muted small">${formatDate(dead.birth)} — ${formatDate(dead.death)}</div><h4>生平</h4>
        <div class="bio">${dead.bio.map((b) => `<div><span class="muted">${formatDate(b.day)}</span> ${esc(b.text)}</div>`).join('')}</div>`;
      return;
    }
    // the lists show the focused polity
    w = view(ui);
    const l = personById(w, w.polity.leaderId);
    const council = w.polity.councilIds.map((id) => personById(w, id)).filter((x): x is Person => !!x);
    const row = (x: Person, extra: string) => `<tr class="click" data-person="${x.id}"><td>${esc(x.name)}</td><td>${Math.floor(ageYears(w, x))}</td><td>${x.occ >= 0 ? OCC_NAMES[x.occ] : '—'}</td><td>${esc(extra)}</td></tr>`;
    const head = '<tr><th>姓名</th><th>年龄</th><th>职业</th><th></th></tr>';
    const richest = [...w.people].sort((a, b) => wealth(b, w.settlements[b.settlement]) - wealth(a, w.settlements[a.settlement])).slice(0, 8);
    const inventors = TECHS.map((t, i) => [t, w.tech.inventor[i]] as const).filter(([, id]) => id >= 0);
    el.innerHTML = `<p class="muted small">点击任何名字或聚落里的小圆点，查看这个人的能力、需求和生平。</p>
      <h4>首领</h4><table class="list">${head}${l ? row(l, `在位 ${Math.floor((w.day - w.polity.leaderSince) / 360)} 年`) : ''}</table>
      <h4>长老议事会</h4><table class="list">${head}${council.map((c) => row(c, `威望 ${c.prestige.toFixed(2)}`)).join('')}</table>
      <h4>最富有的人</h4><table class="list">${head}${richest.map((c) => row(c, `财富 ${wealth(c, w.settlements[c.settlement]).toFixed(0)}`)).join('')}</table>
      <h4>发明者</h4><table class="list"><tr><th>科技</th><th>发明者</th><th>时间</th></tr>${inventors.map(([t, id]) => `<tr><td>${t.name}</td><td>${personLink(w, id)}</td><td>${formatDate(w.tech.day[TECHS.indexOf(t)])}</td></tr>`).join('')}</table>
      <h4>已故名人</h4><table class="list">${w.notables.slice(-30).reverse().map((n) => `<tr class="click" data-person="${n.id}"><td>${esc(n.name)}</td><td class="small muted">${formatDate(n.death)}</td></tr>`).join('')}</table>`;
  },
};

function personDetail(w: World, p: Person): string {
  const s = w.settlements[p.settlement];
  const age = Math.floor(ageYears(w, p));
  const need = foodNeed(w, p);
  const skills = p.skills.map((v, i) => [v, i] as const).filter(([v]) => v > 0.05).sort((a, b) => b[0] - a[0]).slice(0, 3);
  const kids = p.childIds.map((id) => personLink(w, id)).join('、') || '无';
  const prefs = DIMS.map((d, di) => {
    const top = topPref(p, di);
    const cur = w.polity.institutions[di];
    return `<div class="small">${d.name}：<b>${esc(optName(d.id, top))}</b> <span class="muted">${pct(p.prefs[di][top])}</span>${top === cur ? '' : ' <span style="color:var(--warn)">≠现行</span>'}</div>`;
  }).join('');
  const role = roleName(p);
  const faction = w.polity.factions.find((f) => f.id === p.faction);
  return `<div class="person-head"><h3>${esc(p.name)} <span class="muted small">${p.sex ? '男' : '女'} · ${age}岁${role ? ' · ' + role : ''}</span></h3><a class="link" data-person="-1">返回</a></div>
    <div class="muted small">民族：${esc(polityOf(w, p.ethnicity).name)} · 居于${settlementLink(w, p.settlement)} · ${p.occ >= 0 ? OCC_NAMES[p.occ] : age < 16 ? '儿童' : '不再劳动'} · 威望 ${p.prestige.toFixed(2)}</div>
    <div class="grid2">
      <div><h4>能力</h4>${bar('社交', p.social / 100, '#ab47bc', p.social.toFixed(0))}${bar('数学', p.math / 100, '#00acc1', p.math.toFixed(0))}${bar('体能', p.physical / 100, '#c0632b', p.physical.toFixed(0))}
        <h4>性格</h4>${bar('野心', p.ambition, '#ff8a65')}${bar('勤劳', p.diligence, '#b39ddb')}${bar('诚信', p.integrity, '#5cd18b')}${bar('冒险', p.risk, '#ffd54a')}${bar('从众', p.conformity, '#8d98a8')}</div>
      <div><h4>状态</h4>${bar('健康', p.health, '#5cd18b')}${bar('饥饿', p.hunger, '#ff6b6b')}${bar('寒冷', p.cold, '#90caf9')}${bar('幸福', p.happiness, '#ffd54a')}${bar('不满', p.grievance, '#ff8a65')}
        <h4>劳动与声誉</h4><div class="small">今天工作 ${p.hours.toFixed(1)} 小时 · 上月平均 ${p.avgHours.toFixed(1)} 小时/天 · 闲暇 ${Math.max(0, w.params.maxHours - p.avgHours).toFixed(1)} 小时/天</div>
        ${bar('声誉', Math.min(1, p.reputation / 1.5), p.reputation < w.params.exileRep ? '#ff6b6b' : '#4fb3ff', p.reputation.toFixed(2))}
        <div class="small">${p.outsider ? '<span style="color:var(--warn)">外来者</span>，还没在这里挣得认可' : '本地人'}${p.lowRepMonths > 0 ? ` · 已连续 ${p.lowRepMonths} 个月被看作不出力` : ''}</div>
        <h4>财产</h4><div class="small">食物 ${p.food.toFixed(0)}（${(p.food / need).toFixed(0)} 天）· 工具 ${p.tools.toFixed(1)} · 衣物 ${p.clothes.toFixed(1)} · 土地 ${p.plots.toFixed(1)} 块</div>
        <div class="small">上月产出 ${p.output.toFixed(0)} · 财富 ${wealth(p, s).toFixed(0)}</div>
        <div class="small">熟练：${skills.map(([v, i]) => `${OCC_NAMES[i]} ${pct(v)}`).join('，') || '无'}</div></div>
    </div>
    <h4>家庭</h4>
    <div class="small">配偶：${p.spouseId >= 0 ? personLink(w, p.spouseId) : '无'} · 父：${p.fatherId >= 0 ? personLink(w, p.fatherId) : '—'} · 母：${p.motherId >= 0 ? personLink(w, p.motherId) : '—'}</div>
    <div class="small">子女：${kids}</div>
    <h4>政治倾向（最认同的选项）</h4>
    <div class="small" data-wiki="factions">派系：${faction ? `<b>${esc(faction.name)}</b>${faction.leaderId === p.id ? '（领袖）' : ''}` : '无'}${p.noble ? ' · 世家贵族' : ''} · 社会地位排位 ${pct(p.rank)}${p.originRank >= 0 ? `（出身家庭 ${pct(p.originRank)}）` : ''}</div>
    ${prefs}
    <h4>生平</h4><div class="bio">${p.bio.length ? p.bio.map((b) => `<div><span class="muted">${formatDate(b.day)}</span> ${esc(b.text)}</div>`).join('') : '<span class="muted">平凡度日</span>'}</div>`;
}

// --- tech ----------------------------------------------------------------

const tech: Tab = {
  id: 'tech',
  name: '科技',
  mount() {},
  update(el, ui) {
    const w = view(ui);
    const env = envFlags(w);
    const demand = (Object.keys(DOMAIN_NAMES) as Domain[]).map((d) => bar(DOMAIN_NAMES[d], w.demand[d] ?? 0, '#ffb74d')).join('');
    const rows = TECHS.map((t, i) => {
      if (w.tech.known[i]) {
        return `<div class="tech known"><span class="name">✓ ${t.name} <span class="muted">${t.desc}</span></span><span class="small muted">${t.cost ? formatDate(w.tech.day[i]) : '初始'}${w.tech.inventor[i] >= 0 ? ' · ' + personLink(w, w.tech.inventor[i]) : ''}</span></div>`;
      }
      const missingPre = t.prereq.filter((pid) => !w.tech.known[TECHS.findIndex((x) => x.id === pid)]);
      const missingEnv = t.env.filter((e) => !env[e]);
      if (missingPre.length || missingEnv.length) {
        const why = [...missingPre.map((pid) => TECHS.find((x) => x.id === pid)!.name), ...missingEnv.map((e) => ENV_NAMES[e])].join('、');
        return `<div class="tech locked"><span>${t.name} <span class="muted">${t.desc}</span></span><span class="small muted">缺 ${esc(why)}</span></div>`;
      }
      const prog = w.tech.progress[i] / t.cost;
      return `<div class="tech"><span>${t.name} <span class="muted">${t.desc} · ${DOMAIN_NAMES[t.domain]}</span></span>${mini(Math.min(1, prog), 'var(--accent)', '约' + pct(Math.min(prog, 9.99)))}</div>`;
    }).join('');
    void prereqsMet;
    el.innerHTML = `<div><b>${ERAS[w.era]}</b> <span class="muted small">时代由已掌握的科技决定，没有固定时间表</span></div>
      <h4>需求信号（决定研究方向）</h4>${demand}
      <p class="muted small">需求越强，越多人愿意拿出剩余资源资助这个方向；从业者在劳动中也会积累相关经验。进度条是相对标称成本的估计，实际突破点每个世界不同。</p>
      <h4>科技</h4>${rows}`;
  },
};

// --- events --------------------------------------------------------------

const events: Tab = {
  id: 'events',
  name: '事件',
  mount(el, ui) {
    el.innerHTML = `<label class="small"><input type="checkbox" id="ev-major" ${ui.majorOnly ? 'checked' : ''}/> 只看大事件</label><div id="ev-list"></div>`;
    (el.querySelector('#ev-major') as HTMLInputElement).onchange = (e) => {
      ui.majorOnly = (e.target as HTMLInputElement).checked;
      this.update(el, ui);
    };
  },
  update(el, ui) {
    const list = ui.world.events.filter((e) => !ui.majorOnly || e.major).slice(-300).reverse();
    el.querySelector('#ev-list')!.innerHTML = list.map((e) => `<div class="event ${e.major ? 'major' : ''}">
      <div class="when">${formatDate(e.day)}${e.settlement >= 0 ? ' · ' + settlementLink(ui.world, e.settlement) : ''}</div>
      <div class="title">${esc(e.title)}</div><div class="small">${esc(e.text)}</div>
      ${e.people.length ? `<div class="small">${e.people.map((id) => personLink(ui.world, id)).join('、')}</div>` : ''}</div>`).join('') || '<p class="muted">暂无事件</p>';
  },
};

// --- diagnosis -----------------------------------------------------------

const diagnosis: Tab = {
  id: 'diag',
  name: '诊断',
  mount() {},
  update(el, ui) {
    const d = diagnose(view(ui));
    el.innerHTML = `<p class="muted small">这个社会为什么发展或停滞：根据当前状态自动给出的解释。</p>` +
      d.map((x) => `<div class="diag ${x.level}">${esc(x.text)}</div>`).join('');
  },
};

// --- parameters ----------------------------------------------------------

const params: Tab = {
  id: 'params',
  name: '参数',
  mount(el, ui) {
    const w = ui.world;
    const draft: Partial<Params> = {};
    el.innerHTML = `<p class="muted small">所有机制系数都可以调整。修改通过指令队列生效，保证同一种子、同一指令序列可以完整复现。</p>
      <div class="actions"><button id="pa-apply" class="primary">应用修改</button><button id="pa-reset" class="ghost">恢复默认值</button></div>
      ${PARAM_DEFS.map((d) => `<div class="param"><label><span>${d.name}</span><span id="pv-${d.key}">${fmt(w.params[d.key])}</span></label>
        <input type="range" data-key="${d.key}" min="${d.min}" max="${d.max}" step="${d.step}" value="${w.params[d.key]}" />
        <div class="desc">${d.desc}（默认 ${fmt(DEFAULT_PARAMS[d.key])}）</div></div>`).join('')}`;
    el.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((inp) => {
      inp.oninput = () => {
        const k = inp.dataset.key as keyof Params;
        draft[k] = +inp.value;
        (el.querySelector(`#pv-${k}`) as HTMLElement).textContent = fmt(+inp.value);
      };
    });
    (el.querySelector('#pa-apply') as HTMLButtonElement).onclick = () => {
      if (!Object.keys(draft).length) return;
      issue(w, { day: w.day, type: 'params', params: { ...draft } });
      ui.toast('参数将在下一天生效');
    };
    (el.querySelector('#pa-reset') as HTMLButtonElement).onclick = () => {
      issue(w, { day: w.day, type: 'params', params: { ...DEFAULT_PARAMS } });
      ui.toast('已恢复默认参数');
      setTimeout(() => this.mount(el, ui), 50);
    };
  },
  update() {},
};

function fmt(v: number): string {
  return Math.abs(v) < 0.01 && v !== 0 ? v.toExponential(1) : String(+v.toFixed(4));
}

export const TABS: Tab[] = [overview, institutions, settlement, tileTab, people, tech, diplomacy, events, diagnosis, params];
