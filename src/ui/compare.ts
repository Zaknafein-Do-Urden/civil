// Comparison tab (DESIGN.md §8.5): a second run from the same seed under another rule template or
// other parameters, simulated in its own Worker and kept on the same day as this one.

import { PRESETS } from '../core/rules';
import { PARAM_DEFS, DEFAULT_PARAMS } from '../core/params';
import type { Params } from '../core/params';
import type { YearStats } from '../core/types';
import { drawChart } from './chart';
import { esc, pct } from './dom';
import type { StatsReply, Status } from './protocol';
import type { Tab } from './panels';

export interface CompareState {
  /** What differs from this run, e.g. "封建君主制 · 工时疲劳 0.6". */
  label: string;
  status: Status;
  reply?: StatsReply;
}

/** Template choice meaning "the same initial culture as this run". */
export const SAME_CULTURE = 'same';

const A = '#4fb3ff';
const B = '#ff8a65';

const METRICS: { name: string; get: (x: YearStats) => number; min?: number; max?: number }[] = [
  { name: '人口', get: (x) => x.pop, min: 0 },
  { name: '人均日产粮', get: (x) => x.foodPerCap, min: 0 },
  { name: '基尼系数', get: (x) => x.gini, min: 0, max: 1 },
  { name: '已知科技', get: (x) => x.techs, min: 0 },
  { name: '平均工时（小时/天）', get: (x) => x.hours ?? 0, min: 0 },
  { name: '合法性', get: (x) => x.legitimacy, min: 0, max: 1 },
  { name: '幸福', get: (x) => x.happiness, min: 0, max: 1 },
  { name: '饥寒死亡/百人', get: (x) => (x.pop ? (x.starved / x.pop) * 100 : 0), min: 0 },
];

/** Overrides being edited in the form before the run starts. */
let draft: Partial<Params> = {};

export function presetOptions(withSame: boolean): string {
  return (withSame ? `<option value="${SAME_CULTURE}">与本局相同（只改参数）</option>` : '') +
    PRESETS.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
}

const paramLabels = (params: Partial<Params>) =>
  (Object.keys(params) as (keyof Params)[]).map((k) => `${PARAM_DEFS.find((d) => d.key === k)?.name ?? k} ${+params[k]!.toPrecision(4)}`);

export function compareLabel(preset: string, params: Partial<Params>): string {
  const tpl = preset === SAME_CULTURE ? '同一文化' : PRESETS.find((p) => p.id === preset)?.name ?? preset;
  return [tpl, ...paramLabels(params)].join(' · ');
}

export const compare: Tab = {
  id: 'compare',
  name: '对比',
  mount(el, ui) {
    el.innerHTML = `<p class="muted small">用同一个种子、同一个出生地，换一种规则模板或参数再开一局。两局在两个后台线程里并行推进，对比局始终追到与本局同一天（来不及时会落后一些）。对比局不弹大事件、不能操作，也不随存档保存。</p>
      <div id="cmp-form"><div class="field-row"><label>对比局模板 <select id="cmp-preset">${presetOptions(true)}</select></label></div>
      <div class="field-row"><label>改一个参数 <select id="cmp-key"><option value="">—</option>${PARAM_DEFS.map((d) => `<option value="${d.key}">${esc(d.name)}</option>`).join('')}</select></label>
        <input id="cmp-val" type="number" step="any" style="width:90px" /><button id="cmp-add" class="ghost">加入</button></div>
      <div id="cmp-draft" class="small muted"></div>
      <div class="actions"><button id="cmp-go" class="primary">开对比局</button></div></div>
      <div id="cmp-run"><div class="field-row"><b id="cmp-label"></b><button id="cmp-stop" class="ghost">结束对比</button></div>
      <div id="cmp-kpis"></div><div id="cmp-charts"></div></div>`;
    const keySel = el.querySelector('#cmp-key') as HTMLSelectElement;
    const val = el.querySelector('#cmp-val') as HTMLInputElement;
    const showDraft = () => {
      (el.querySelector('#cmp-draft') as HTMLElement).textContent = Object.keys(draft).length ? `参数改动：${paramLabels(draft).join('，')}` : '参数与本局开局时相同（默认值）。';
    };
    keySel.onchange = () => {
      const k = keySel.value as keyof Params;
      val.value = k ? String(draft[k] ?? DEFAULT_PARAMS[k]) : '';
    };
    (el.querySelector('#cmp-add') as HTMLButtonElement).onclick = () => {
      const k = keySel.value as keyof Params;
      if (!k || val.value === '' || !Number.isFinite(+val.value)) return;
      draft[k] = +(+val.value).toPrecision(6);
      showDraft();
    };
    (el.querySelector('#cmp-go') as HTMLButtonElement).onclick = () => {
      ui.startCompare((el.querySelector('#cmp-preset') as HTMLSelectElement).value, { ...draft });
      draft = {};
      showDraft();
      compare.update(el, ui);
    };
    (el.querySelector('#cmp-stop') as HTMLButtonElement).onclick = () => {
      ui.stopCompare();
      compare.update(el, ui);
    };
    showDraft();
  },
  update(el, ui) {
    const c = ui.compare;
    (el.querySelector('#cmp-form') as HTMLElement).style.display = c ? 'none' : '';
    const run = el.querySelector('#cmp-run') as HTMLElement;
    run.style.display = c ? '' : 'none';
    if (!c) return;
    const w = ui.world;
    const r = c.reply;
    (el.querySelector('#cmp-label') as HTMLElement).textContent = `对比局：${c.label}`;
    const mine = w.stats;
    const theirs = r?.stats ?? [];
    const lag = w.day - c.status.day;
    const lastA = mine[mine.length - 1];
    const lastB = theirs[theirs.length - 1];
    const row = (k: string, a: string, b: string) => `<tr><td>${k}</td><td>${a}</td><td>${b}</td></tr>`;
    el.querySelector('#cmp-kpis')!.innerHTML = `<table class="list"><tr><th></th><th style="color:${A}">本局</th><th style="color:${B}">对比局</th></tr>
      ${row('名称', esc(w.polity.name), r ? esc(r.name) : '…')}
      ${row('进度', `第 ${Math.floor(w.day / 360) + 1} 年`, `第 ${Math.floor(c.status.day / 360) + 1} 年${lag > 30 ? `（落后 ${lag} 天）` : ''}`)}
      ${row('人口（最近年末）', lastA ? String(lastA.pop) : '—', lastB ? String(lastB.pop) : '—')}
      ${row('已知科技', String(w.tech.known.filter(Boolean).length), r ? String(r.techs) : '—')}
      ${row('合法性', pct(w.polity.legitimacy), r ? pct(r.legitimacy) : '—')}
      ${row('基尼系数（最近年末）', lastA ? lastA.gini.toFixed(2) : '—', lastB ? lastB.gini.toFixed(2) : '—')}</table>`;
    const charts = el.querySelector('#cmp-charts') as HTMLElement;
    if (charts.childElementCount !== METRICS.length) {
      charts.innerHTML = METRICS.map((m) => `<h4>${m.name}</h4><canvas class="chart"></canvas>`).join('');
    }
    // the same years from both runs, thinned identically
    const longer = mine.length >= theirs.length ? mine : theirs;
    const step = Math.max(1, Math.ceil(longer.length / 400));
    const idx = longer.map((_, i) => i).filter((i) => i % step === 0 || i === longer.length - 1);
    const xs = idx.map((i) => longer[i].year);
    const pick = (st: YearStats[], get: (x: YearStats) => number) => idx.filter((i) => i < st.length).map((i) => get(st[i]));
    charts.querySelectorAll('canvas').forEach((cv, i) => {
      const m = METRICS[i];
      drawChart(cv, xs, [
        { name: '本局', color: A, values: pick(mine, m.get) },
        { name: '对比局', color: B, values: pick(theirs, m.get) },
      ], { min: m.min, max: m.max });
    });
  },
};
