// Goals tab and the end-of-scenario review (DESIGN.md §16).

import { formatDate } from '../core/events';
import { PLAYER } from '../core/nations';
import { DIMS, optName } from '../core/rules';
import { scenarioById } from '../core/scenarios';
import { TERMS_NAMES } from '../core/war';
import { DAYS_PER_YEAR } from '../core/types';
import type { Command, World } from '../core/types';
import { drawChart } from './chart';
import { esc } from './dom';
import type { Tab } from './panels';

function yearOf(day: number): number {
  return Math.floor(day / DAYS_PER_YEAR);
}

/** Short standing for the top bar. */
export function goalSummary(w: World): string {
  const st = w.scenario;
  const sc = scenarioById(st.id);
  if (sc.id === 'sandbox') return '';
  if (st.status !== 'playing') return `${sc.name}：${st.status === 'won' ? '已完成' : '已失败'}`;
  const g = sc.goals[0];
  return `${sc.name} · 第 ${yearOf(w.day)} / ${sc.years} 年${g?.progress ? ' · ' + g.progress(w, st) : ''}`;
}

export const goals: Tab = {
  id: 'goals',
  name: '目标',
  mount(el) {
    el.innerHTML = '<div id="goal-body"></div>';
  },
  update(el, ui) {
    const w = ui.world;
    const st = w.scenario;
    const sc = scenarioById(st.id);
    const mark = (ok: boolean) => (ok ? '<span style="color:var(--good, #5cd18b)">✓</span>' : '<span class="muted">○</span>');
    const status = st.status === 'playing'
      ? (sc.years ? `进行中：第 ${yearOf(w.day)} 年，还剩 ${Math.max(0, sc.years - yearOf(w.day))} 年` : '进行中')
      : `<b style="color:var(--accent-2)">${st.status === 'won' ? '已完成' : '已失败'}</b>（${formatDate(st.endDay)}）：${esc(st.outcome)} 之后以沙盒方式继续。`;
    el.querySelector('#goal-body')!.innerHTML = `<h3>${esc(sc.name)}</h3>
      <p class="small">${esc(sc.desc)}</p><p class="small">${status}</p>
      ${sc.goals.length ? `<h4>目标${sc.atEnd ? '（时限到时判定）' : ''}</h4>${sc.goals.map((g) => `<div class="small">${mark(g.test(w, st))} ${esc(g.name)}${g.progress ? ` <span class="muted">— ${esc(g.progress(w, st))}</span>` : ''}</div>`).join('')}` : ''}
      ${sc.milestones.length ? `<h4>里程碑</h4>${sc.milestones.map((m) => `<div class="small">${mark(st.milestones[m.id] !== undefined)} ${esc(m.name)}${st.milestones[m.id] !== undefined ? ` <span class="muted">— ${formatDate(st.milestones[m.id])}</span>` : ''}</div>`).join('')}` : ''}
      <h4>失败条件</h4>${sc.fails.map((f) => `<div class="small">✗ ${esc(f.name)}${f.progress ? ` <span class="muted">— ${esc(f.progress(w, st))}</span>` : ''}</div>`).join('')}
      ${sc.shocks.length ? `<h4>环境变化</h4>${sc.shocks.map((k) => `<div class="small">${esc(k.desc)}（现在：${(w.params[k.key] as number).toFixed(2)}）</div>`).join('')}` : ''}
      ${st.status !== 'playing' ? '<div class="actions"><button data-review="1">查看复盘</button></div>' : ''}
      ${st.takeovers.length ? `<p class="muted small">失败后接手过 ${st.takeovers.length} 次其他国家。</p>` : ''}`;
  },
};

function commandText(w: World, c: Command): string {
  switch (c.type) {
    case 'decree':
      return `法令：${DIMS[c.dim].name}改为「${optName(DIMS[c.dim].id, c.opt)}」`;
    case 'relief':
      return `开仓赈济${w.settlements[c.settlement]?.name ?? ''}`;
    case 'exempt':
      return `免去${w.settlements[c.settlement]?.name ?? ''} ${c.years} 年赋税`;
    case 'declare':
      return `宣战（${c.goal === 'raid' ? '抢粮' : '扩张'}）`;
    case 'peace':
      return `议和：${TERMS_NAMES[c.terms]}`;
    case 'movement':
      return `推动思潮：${DIMS[c.dim].name}「${optName(DIMS[c.dim].id, c.opt)}」`;
    case 'warMood':
      return c.value > 0 ? '推动主战思潮' : '推动主和思潮';
    default:
      return '';
  }
}

/** The review shown when a scenario ends: what happened, how the country fared, what the player did. */
export function reviewHtml(w: World): string {
  const st = w.scenario;
  const sc = scenarioById(st.id);
  const timeline = w.events
    .filter((e) => e.major && e.polity === undefined && e.kind !== 'decision' && e.day <= st.endDay)
    .slice(-14)
    .map((e) => `<div class="small"><span class="muted">${formatDate(e.day)}</span> ${esc(e.title)}</div>`).join('');
  const deeds = w.commandLog
    .filter((c) => c.day <= st.endDay)
    .map((c) => [c, commandText(w, c)] as const)
    .filter(([, t]) => t)
    .slice(-12)
    .map(([c, t]) => `<div class="small"><span class="muted">${formatDate(c.day)}</span> ${esc(t)}</div>`).join('');
  const decided = w.commandLog.filter((c) => c.type === 'decide' && c.day <= st.endDay).length;
  const canStay = w.polity.alive && w.settlements.some((s) => s.alive && s.polity === PLAYER);
  return `<div class="modal-box review"><div class="when">${formatDate(st.endDay)} · ${esc(sc.name)}</div>
    <h2>${st.status === 'won' ? '剧本完成' : '剧本失败'}</h2><p>${esc(st.outcome)}</p>
    <h4>人口、合法性与不满</h4><canvas class="chart" id="rv-chart"></canvas>
    <h4>大事记</h4>${timeline || '<p class="muted small">无</p>'}
    <h4>你做过的决定</h4><p class="small muted">裁决了 ${decided} 张待决卡片。</p>${deeds || '<p class="muted small">没有主动颁布过法令或用兵。</p>'}
    <div class="actions">
      ${canStay ? '<button id="rv-stay" class="primary">继续当前国家（沙盒）</button>' : ''}
      <button id="rv-pick" class="${canStay ? 'ghost' : 'primary'}">在地图上选一个聚落，接手它所属的国家</button>
      ${canStay ? '' : '<button id="rv-watch" class="ghost">只是看看</button>'}
    </div></div>`;
}

export function drawReviewChart(canvas: HTMLCanvasElement, w: World): void {
  const s = w.stats;
  const pop0 = Math.max(1, ...s.map((x) => x.pop));
  drawChart(canvas, s.map((x) => x.year), [
    { name: '人口（相对最高）', color: '#4fb3ff', values: s.map((x) => x.pop / pop0) },
    { name: '合法性', color: '#ffd54a', values: s.map((x) => x.legitimacy) },
    { name: '不满', color: '#ff6b6b', values: s.map((x) => x.grievance) },
  ], { min: 0, max: 1 });
}

