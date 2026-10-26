import { DIMS, PRESETS, UNSPECIFIED } from '../core/rules';
import type { CultureSetting, DimId } from '../core/rules';
import { TERRAIN_NAMES, generateMap, isLand, siteScore, tilesWithin } from '../core/map';
import { DEFAULT_BAND_SIZE, createWorld, deserialize, serialize, step } from '../core/sim';
import { ERAS } from '../core/tech';
import { formatDate } from '../core/events';
import { personById } from '../core/person';
import type { GameEvent, Tile, World, WorldMap } from '../core/types';
import { MapView } from './mapView';
import type { Overlay } from './mapView';
import { $, download, esc, pct } from './dom';
import { TABS } from './panels';
import type { Ui } from './panels';

const SAVE_KEY = 'civil.save.v1';
const SPEEDS = [1, 2, 5, 10, 100];
const WORDS = ['黄河', '昆仑', '长风', '星火', '青铜', '远古', '曙光', '大泽', '石林', '云梦', '沧海', '烽烟'];

// ------------------------------------------------------------------ setup

let setupMap: WorldMap | undefined;
let startTile = -1;
const setupView = new MapView($('#setup-map') as HTMLCanvasElement, (t) => {
  if (!isLand(t)) return;
  startTile = t.id;
  setupView.selectedTile = t.id;
  setupView.draw();
  showTileInfo(t);
});

function randomSeed(): string {
  return WORDS[Math.floor(Math.random() * WORDS.length)] + Math.floor(Math.random() * 10000);
}

function regenerate(): void {
  const seed = ($('#seed') as HTMLInputElement).value.trim() || randomSeed();
  setupMap = generateMap(seed);
  setupView.setMap(setupMap);
  pickBestSite();
}

function pickBestSite(): void {
  if (!setupMap) return;
  let best: Tile | undefined;
  let bs = -Infinity;
  for (const t of setupMap.tiles) {
    const s = siteScore(setupMap, t, false);
    if (s > bs) {
      bs = s;
      best = t;
    }
  }
  if (best) {
    startTile = best.id;
    setupView.selectedTile = best.id;
    showTileInfo(best);
  }
  setupView.draw();
}

function showTileInfo(t: Tile): void {
  if (!setupMap) return;
  const near = tilesWithin(setupMap, t, 2);
  const has = (k: 'grain' | 'animals' | 'copper' | 'tin' | 'clay') => near.some((n) => n[k]);
  const res = [has('grain') && '野生谷物', has('animals') && '可驯化动物', has('clay') && '黏土', has('copper') && '铜矿', has('tin') && '锡矿', near.some((n) => n.river) && '河流', near.some((n) => n.coast) && '海岸']
    .filter(Boolean).join('、');
  $('#tile-info').innerHTML = `<b>${TERRAIN_NAMES[t.terrain]}</b> · 年均 ${t.temp.toFixed(0)}°C · 降水 ${pct(t.rain)}<br/>
    周边资源：${res || '贫乏'}<br/>宜居评分：${siteScore(setupMap, t, false).toFixed(0)}`;
}

function buildDims(): void {
  $('#dims').innerHTML = DIMS.map((d) => `<div class="dim-row"><span class="dim-name">${d.name}</span>
    <select data-dim="${d.id}"><option value="">不指定（自由演化）</option>${d.options.map((o) => `<option value="${o.id}">${o.name}</option>`).join('')}</select>
    <span class="dim-desc">${d.desc}</span></div>`).join('');
  const presetSel = $('#preset') as HTMLSelectElement;
  presetSel.innerHTML = PRESETS.map((p) => `<option value="${p.id}">${p.name}</option>`).join('');
  presetSel.onchange = () => applyPreset(presetSel.value);
  applyPreset('none');
}

function applyPreset(id: string): void {
  const p = PRESETS.find((x) => x.id === id) ?? PRESETS[0];
  $('#preset-desc').textContent = p.desc;
  document.querySelectorAll<HTMLSelectElement>('#dims select').forEach((sel) => {
    sel.value = p.culture[sel.dataset.dim as DimId] ?? '';
  });
}

function readCulture(): CultureSetting {
  const c: CultureSetting = { ...UNSPECIFIED };
  document.querySelectorAll<HTMLSelectElement>('#dims select').forEach((sel) => {
    c[sel.dataset.dim as DimId] = sel.value || null;
  });
  return c;
}

function readPopulation(): number {
  return Math.max(200, Math.min(3000, +($('#population') as HTMLInputElement).value || 1000));
}

function readBandSize(): number {
  return Math.max(20, Math.min(500, +($('#band-size') as HTMLInputElement).value || DEFAULT_BAND_SIZE));
}

/** Tell the player up front that the tribe starts as several camps, not one village. */
function updateBandHint(): void {
  const pop = readPopulation();
  const n = Math.max(1, Math.round(pop / readBandSize()));
  $('#band-hint').textContent = n === 1
    ? `${pop} 人全部住在同一个营地。`
    : `石器时代的人靠采集狩猎为生，一块地养不活太多人，所以 ${pop} 人不会住在同一个村落，而是分成约 ${n} 个群落（每个约 ${Math.round(pop / n)} 人），散布在出生地附近，共同组成一个部落。附近地形太差时群落会少一些、每个人多一些。群落之后会自行壮大、分裂、迁徙；真实的狩猎采集营地通常 25–50 人。`;
}

($('#seed') as HTMLInputElement).value = randomSeed();
($('#population') as HTMLInputElement).oninput = updateBandHint;
($('#band-size') as HTMLInputElement).oninput = updateBandHint;
($('#seed') as HTMLInputElement).onchange = regenerate;
$('#reroll').onclick = () => {
  ($('#seed') as HTMLInputElement).value = randomSeed();
  regenerate();
};
$('#best-site').onclick = pickBestSite;
$('#start').onclick = () => {
  const seed = ($('#seed') as HTMLInputElement).value.trim() || randomSeed();
  startGame(createWorld({ seed, culture: readCulture(), startTile, population: readPopulation(), bandSize: readBandSize() }));
};
$('#load-local').onclick = () => {
  try {
    const s = localStorage.getItem(SAVE_KEY);
    if (!s) return toast('没有找到存档');
    startGame(deserialize(s));
  } catch {
    toast('读取存档失败');
  }
};
($('#load-file') as HTMLInputElement).onchange = async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  try {
    startGame(deserialize(await f.text()));
  } catch {
    toast('存档文件无法解析');
  }
};
buildDims();
updateBandHint();
regenerate();
window.addEventListener('resize', () => {
  setupView.draw();
  if (game) game.view.draw(game.ui.world);
});

// ------------------------------------------------------------------- game

interface Game {
  ui: Ui;
  view: MapView;
  running: boolean;
  speed: number;
  fastForward: boolean;
  acc: number;
  lastSeq: number;
  lastPanel: number;
  daysThisSecond: number;
  rateStamp: number;
  rate: number;
  modalQueue: GameEvent[];
}

let game: Game | undefined;
let toastTimer = 0;

function toast(msg: string): void {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.add('hidden'), 2200);
}

function startGame(world: World): void {
  $('#setup').classList.add('hidden');
  $('#game').classList.remove('hidden');
  const ui: Ui = {
    world,
    tab: 'overview',
    personId: -1,
    settlementId: -1,
    majorOnly: false,
    select(kind, id) {
      if (kind === 'person') {
        ui.personId = id;
        switchTab('people');
      } else {
        ui.settlementId = id;
        if (game) game.view.selectedSettlement = id;
        switchTab('settlement');
      }
      refresh(true);
    },
    toast,
  };
  const view = new MapView($('#map') as HTMLCanvasElement, (t) => {
    const s = world.settlements.find((x) => x.alive && (x.tile === t.id || x.territory.includes(t.id)));
    if (s) ui.select('settlement', s.id);
  });
  view.setMap(world.map);
  game = {
    ui, view, running: false, speed: 1, fastForward: false, acc: 0,
    lastSeq: world.eventSeq, lastPanel: 0, daysThisSecond: 0, rateStamp: performance.now(), rate: 0, modalQueue: [],
  };
  $('#speeds').innerHTML = SPEEDS.map((s) => `<button data-speed="${s}">${s}×</button>`).join('');
  buildTabs();
  setRunning(false);
  setSpeed(1);
  refresh(true);
  // dev hook for inspecting and fast-forwarding from the console
  if (import.meta.env.DEV) Object.assign(window, { civil: { game, step, refresh } });
}

function buildTabs(): void {
  $('#tabs').innerHTML = TABS.map((t) => `<button data-tab="${t.id}">${t.name}</button>`).join('');
  switchTab(game!.ui.tab);
}

function switchTab(id: string): void {
  const g = game!;
  const tab = TABS.find((t) => t.id === id) ?? TABS[0];
  const changed = g.ui.tab !== tab.id || !$('#tab-body').dataset.mounted;
  g.ui.tab = tab.id;
  document.querySelectorAll<HTMLButtonElement>('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab.id));
  if (changed) {
    const body = $('#tab-body');
    body.dataset.mounted = tab.id;
    body.scrollTop = 0;
    tab.mount(body, g.ui);
    tab.update(body, g.ui);
  }
}

function refresh(force = false): void {
  const g = game;
  if (!g) return;
  const w = g.ui.world;
  const l = personById(w, w.polity.leaderId);
  $('#tb-date').textContent = formatDate(w.day);
  $('#tb-era').textContent = ERAS[w.era];
  $('#tb-summary').innerHTML = `人口 ${w.people.length} · 首领 ${l ? esc(l.name) : '—'} · 合法性 ${pct(w.polity.legitimacy)}`;
  $('#tb-rate').textContent = g.running ? `实际 ${g.rate.toFixed(0)} 天/秒` : '';
  const now = performance.now();
  if (force || now - g.lastPanel > 400) {
    g.lastPanel = now;
    g.view.draw(w);
    const tab = TABS.find((t) => t.id === g.ui.tab)!;
    const body = $('#tab-body');
    const top = body.scrollTop;
    tab.update(body, g.ui);
    body.scrollTop = top;
  }
}

function setRunning(r: boolean): void {
  const g = game!;
  g.running = r;
  if (!r) g.fastForward = false;
  $('#pause').textContent = r ? '⏸ 暂停' : '▶ 继续';
  $('#ffwd').classList.toggle('on', g.fastForward);
}

function setSpeed(s: number): void {
  const g = game!;
  g.speed = s;
  g.fastForward = false;
  document.querySelectorAll<HTMLButtonElement>('#speeds button').forEach((b) => b.classList.toggle('on', +b.dataset.speed! === s));
  $('#ffwd').classList.remove('on');
}

function showModal(): void {
  const g = game!;
  const ev = g.modalQueue[0];
  if (!ev) {
    $('#modal').classList.add('hidden');
    return;
  }
  const w = g.ui.world;
  const people = ev.people.map((id) => personById(w, id)).filter(Boolean);
  $('#modal').innerHTML = `<div class="modal-box"><div class="when">${formatDate(ev.day)}${g.modalQueue.length > 1 ? ` · 还有 ${g.modalQueue.length - 1} 件` : ''}</div>
    <h2>${esc(ev.title)}</h2><p>${esc(ev.text)}</p>
    ${people.length ? `<p class="small">相关人物：${people.map((p) => `<a class="link" data-person="${p!.id}">${esc(p!.name)}</a>`).join('、')}</p>` : ''}
    <div class="actions"><button id="m-next" class="primary">${g.modalQueue.length > 1 ? '下一件' : '知道了'}</button><button id="m-resume" class="ghost">继续运行</button></div></div>`;
  $('#modal').classList.remove('hidden');
  $('#m-next').onclick = () => {
    g.modalQueue.shift();
    showModal();
  };
  $('#m-resume').onclick = () => {
    g.modalQueue = [];
    showModal();
    setRunning(true);
  };
}

let lastT = 0;

function loop(t: number): void {
  requestAnimationFrame(loop);
  const dt = lastT ? Math.min(100, t - lastT) : 16;
  lastT = t;
  const g = game;
  if (!g) return;
  const w = g.ui.world;
  if (g.running && !g.modalQueue.length && w.people.length) {
    const budget = g.fastForward ? 40 : 25;
    const start = performance.now();
    if (!g.fastForward) g.acc += (g.speed * dt) / 1000;
    let steps = 0;
    while ((g.fastForward || g.acc >= 1) && performance.now() - start < budget) {
      step(w);
      steps++;
      if (!g.fastForward) g.acc -= 1;
      if (w.eventSeq !== g.lastSeq) {
        const fresh = w.events.filter((e) => e.seq >= g.lastSeq);
        g.lastSeq = w.eventSeq;
        const major = fresh.filter((e) => e.major);
        if (major.length) {
          g.modalQueue.push(...major);
          setRunning(false);
          showModal();
          refresh(true);
          break;
        }
      }
    }
    if (g.acc > g.speed) g.acc = g.speed; // don't build an unbounded backlog when the sim can't keep up
    g.daysThisSecond += steps;
    if (t - g.rateStamp > 1000) {
      g.rate = (g.daysThisSecond * 1000) / (t - g.rateStamp);
      g.daysThisSecond = 0;
      g.rateStamp = t;
    }
    refresh();
  }
}
requestAnimationFrame(loop);

// ------------------------------------------------------------- controls

document.addEventListener('keydown', (e) => {
  if (!game || e.code !== 'Space') return;
  const tag = (e.target as HTMLElement).tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  e.preventDefault();
  if (game.modalQueue.length) {
    game.modalQueue = [];
    showModal();
  }
  setRunning(!game.running);
});

document.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-person],[data-settlement],[data-tab],[data-speed],[data-overlay]');
  if (!el || !game) return;
  if (el.dataset.person !== undefined) {
    if ($('#modal').contains(el)) {
      game.modalQueue = [];
      showModal();
    }
    game.ui.select('person', +el.dataset.person);
  } else if (el.dataset.settlement !== undefined) game.ui.select('settlement', +el.dataset.settlement);
  else if (el.dataset.tab) {
    switchTab(el.dataset.tab);
    refresh(true);
  } else if (el.dataset.speed) {
    setSpeed(+el.dataset.speed);
    setRunning(true);
  } else if (el.dataset.overlay) {
    game.view.overlay = el.dataset.overlay as Overlay;
    document.querySelectorAll<HTMLButtonElement>('#map-tools button').forEach((b) => b.classList.toggle('on', b === el));
    refresh(true);
  }
});

$('#pause').onclick = () => game && setRunning(!game.running);
$('#ffwd').onclick = () => {
  if (!game) return;
  game.fastForward = true;
  game.running = true;
  $('#pause').textContent = '⏸ 暂停';
  $('#ffwd').classList.add('on');
};
$('#save').onclick = () => {
  if (!game) return;
  try {
    localStorage.setItem(SAVE_KEY, serialize(game.ui.world));
    toast('已保存到浏览器');
  } catch {
    toast('浏览器存储空间不足，请使用"导出"');
  }
};
$('#export').onclick = () => {
  if (!game) return;
  download(`civil-${game.ui.world.seed}-${game.ui.world.day}.json`, serialize(game.ui.world));
};
$('#new-game').onclick = () => {
  if (!game) return;
  setRunning(false);
  game = undefined;
  $('#game').classList.add('hidden');
  $('#setup').classList.remove('hidden');
  delete $('#tab-body').dataset.mounted;
  setupView.draw();
};
