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
import { formatDate } from '../core/events';
import { TERRAIN_NAMES } from '../core/map';
import { issue } from '../core/sim';
import { NOCC, OCC, OCC_COLORS, OCC_NAMES } from '../core/types';
import type { Person, World } from '../core/types';
import { bar, esc, mini, pct } from './dom';
import { drawChart } from './chart';
import { settlementColor } from './mapView';

export interface Ui {
  world: World;
  tab: string;
  personId: number;
  settlementId: number;
  majorOnly: boolean;
  select(kind: 'person' | 'settlement', id: number): void;
  toast(msg: string): void;
}

interface Tab {
  id: string;
  name: string;
  mount(el: HTMLElement, ui: Ui): void;
  update(el: HTMLElement, ui: Ui): void;
}

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
    const w = ui.world;
    const st = w.stats;
    const last = st[st.length - 1];
    const l = personById(w, w.polity.leaderId);
    const lm = w.lastMonth;
    const tinkers = w.people.filter((p) => p.occ === OCC.tinker).length;
    let griev = 0;
    let eff = 0;
    let workers = 0;
    for (const p of w.people) {
      griev += p.grievance;
      if (p.occ >= 0) {
        eff += p.effort;
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
      kpi('平均努力', pct(eff / Math.max(1, workers))),
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
      { name: '努力', color: '#b39ddb', values: s.map((x) => x.effort) },
    ], { min: 0, max: 1 });
    drawChart(el.querySelector('#ch-pol')!, xs, [
      { name: '基尼系数', color: '#ff8a65', values: s.map((x) => x.gini) },
      { name: '合法性', color: '#4fb3ff', values: s.map((x) => x.legitimacy) },
    ], { min: 0, max: 1 });
    drawChart(el.querySelector('#ch-prod')!, xs, [
      { name: '人均日产粮', color: '#f9a825', values: s.map((x) => x.foodPerCap) },
      { name: '饥寒死亡/百人', color: '#ff6b6b', values: s.map((x) => (x.pop ? (x.starved / x.pop) * 100 : 0)) },
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
      <h3>各聚落执行情况</h3><div id="inst-settlements"></div>
      <h3>推动思潮</h3>
      <p class="muted small">让一部分理想主义者开始鼓吹某个选项。其他人会按各自利益决定支持还是反对，结果可能是改革、被否决或引发革命。</p>
      <div class="field-row"><label>维度 <select id="mv-dim">${DIMS.map((d, i) => `<option value="${i}">${d.name}</option>`).join('')}</select></label></div>
      <div class="field-row"><label>主张 <select id="mv-opt"></select></label></div>
      <div class="field-row"><label>理想主义者比例 <input id="mv-str" type="range" min="5" max="50" value="20" /> <span id="mv-str-v">20%</span></label></div>
      <button id="mv-go" class="primary">发起思潮</button>`;
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
    const w = ui.world;
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
    const rows = w.settlements.filter((s) => s.alive).map((s) => {
      const diff = DIMS.map((d, di) => (s.practiced[di] !== w.polity.institutions[di] ? `${d.name}:${optName(d.id, s.practiced[di])}` : '')).filter(Boolean);
      return `<tr class="click" data-settlement="${s.id}"><td><span style="color:${settlementColor(s.id)}">●</span> ${esc(s.name)}${s.id === w.polity.capital ? ' ★' : ''}</td><td>${s.pop}</td><td>${s.distance.toFixed(1)}</td><td>${pct(s.enforcement)}</td><td class="small">${diff.length ? esc(diff.join('，')) : '<span class="muted">与国家一致</span>'}</td></tr>`;
    });
    el.querySelector('#inst-settlements')!.innerHTML = `<table class="list"><tr><th>聚落</th><th>人口</th><th>距首都</th><th>执行力</th><th>本地实际做法</th></tr>${rows.join('')}</table>`;
  },
};

// --- settlement ----------------------------------------------------------

const settlement: Tab = {
  id: 'settlement',
  name: '聚落',
  mount() {},
  update(el, ui) {
    const w = ui.world;
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
    const sorted = [...people].sort((a, b) => (a.occ - b.occ) || (b.prestige - a.prestige));
    const dots = sorted.map((p) => {
      const child = ageYears(w, p) < 16;
      const color = p.occ >= 0 ? OCC_COLORS[p.occ] : '#555';
      const elite = p.role !== 'none' ? 'elite' : '';
      return `<span class="dot ${child ? 'child' : ''} ${elite}" style="background:${color}" data-person="${p.id}" title="${esc(p.name)} ${Math.floor(ageYears(w, p))}岁 ${p.occ >= 0 ? OCC_NAMES[p.occ] : child ? '儿童' : '老人'}"></span>`;
    }).join('');
    const diff = DIMS.map((d, di) => `<div class="small">${d.name}：<b>${esc(optName(d.id, s.practiced[di]))}</b>${s.practiced[di] !== w.polity.institutions[di] ? ' <span style="color:var(--warn)">（与国家不同）</span>' : ''}</div>`).join('');
    el.innerHTML = `<div class="person-head"><h3><span style="color:${settlementColor(s.id)}">●</span> ${esc(s.name)}${s.id === w.polity.capital ? ' ★首都' : ''}</h3><a class="link" data-settlement="-1">全部聚落</a></div>
      <div class="muted small">建于${formatDate(s.founded)} · ${TERRAIN_NAMES[tile.terrain]} · 年均 ${tile.temp.toFixed(0)}°C · ${tile.river ? '河畔' : ''}${tile.coast ? '海滨' : ''}</div>
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

// --- people --------------------------------------------------------------

const people: Tab = {
  id: 'people',
  name: '人物',
  mount() {},
  update(el, ui) {
    const w = ui.world;
    const p = personById(w, ui.personId);
    if (p) {
      el.innerHTML = personDetail(w, p);
      return;
    }
    const dead = w.notables.find((x) => x.id === ui.personId);
    if (dead) {
      el.innerHTML = `<div class="person-head"><h3>${esc(dead.name)} <span class="muted small">（已故）</span></h3><a class="link" data-person="-1">返回</a></div>
        <div class="muted small">${formatDate(dead.birth)} — ${formatDate(dead.death)}</div><h4>生平</h4>
        <div class="bio">${dead.bio.map((b) => `<div><span class="muted">${formatDate(b.day)}</span> ${esc(b.text)}</div>`).join('')}</div>`;
      return;
    }
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
  return `<div class="person-head"><h3>${esc(p.name)} <span class="muted small">${p.sex ? '男' : '女'} · ${age}岁${role ? ' · ' + role : ''}</span></h3><a class="link" data-person="-1">返回</a></div>
    <div class="muted small">居于${settlementLink(w, p.settlement)} · ${p.occ >= 0 ? OCC_NAMES[p.occ] : age < 16 ? '儿童' : '不再劳动'} · 威望 ${p.prestige.toFixed(2)}</div>
    <div class="grid2">
      <div><h4>能力</h4>${bar('社交', p.social / 100, '#ab47bc', p.social.toFixed(0))}${bar('数学', p.math / 100, '#00acc1', p.math.toFixed(0))}${bar('体能', p.physical / 100, '#c0632b', p.physical.toFixed(0))}
        <h4>性格</h4>${bar('野心', p.ambition, '#ff8a65')}${bar('诚信', p.integrity, '#5cd18b')}${bar('冒险', p.risk, '#ffd54a')}${bar('从众', p.conformity, '#8d98a8')}</div>
      <div><h4>状态</h4>${bar('健康', p.health, '#5cd18b')}${bar('饥饿', p.hunger, '#ff6b6b')}${bar('寒冷', p.cold, '#90caf9')}${bar('幸福', p.happiness, '#ffd54a')}${bar('不满', p.grievance, '#ff8a65')}${bar('努力', p.effort, '#b39ddb')}
        <h4>财产</h4><div class="small">食物 ${p.food.toFixed(0)}（${(p.food / need).toFixed(0)} 天）· 工具 ${p.tools.toFixed(1)} · 衣物 ${p.clothes.toFixed(1)} · 土地 ${p.plots.toFixed(1)} 块</div>
        <div class="small">上月产出 ${p.output.toFixed(0)} · 财富 ${wealth(p, s).toFixed(0)}</div>
        <div class="small">熟练：${skills.map(([v, i]) => `${OCC_NAMES[i]} ${pct(v)}`).join('，') || '无'}</div></div>
    </div>
    <h4>家庭</h4>
    <div class="small">配偶：${p.spouseId >= 0 ? personLink(w, p.spouseId) : '无'} · 父：${p.fatherId >= 0 ? personLink(w, p.fatherId) : '—'} · 母：${p.motherId >= 0 ? personLink(w, p.motherId) : '—'}</div>
    <div class="small">子女：${kids}</div>
    <h4>政治倾向（最认同的选项）</h4>${prefs}
    <h4>生平</h4><div class="bio">${p.bio.length ? p.bio.map((b) => `<div><span class="muted">${formatDate(b.day)}</span> ${esc(b.text)}</div>`).join('') : '<span class="muted">平凡度日</span>'}</div>`;
}

// --- tech ----------------------------------------------------------------

const tech: Tab = {
  id: 'tech',
  name: '科技',
  mount() {},
  update(el, ui) {
    const w = ui.world;
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
    const d = diagnose(ui.world);
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

export const TABS: Tab[] = [overview, institutions, settlement, people, tech, events, diagnosis, params];
