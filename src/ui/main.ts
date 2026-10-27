import { DIMS, PRESETS, UNSPECIFIED } from '../core/rules';
import type { CultureSetting, DimId } from '../core/rules';
import { TERRAIN_NAMES, generateMap, isLand, siteScore, tilesWithin } from '../core/map';
import './wikiView';
import { DEFAULT_NPC_COUNT, DEFAULT_NPC_POPULATION } from '../core/sim';
import type { WorldConfig } from '../core/sim';
import type { Params } from '../core/params';
import { PLAYER, peopleOf } from '../core/nations';
import { focusBanner } from './diplomacy';
import { ERAS } from '../core/tech';
import { formatDate } from '../core/events';
import { personById } from '../core/person';
import type { GameEvent, Tile, World, WorldMap } from '../core/types';
import { SimClient } from './simClient';
import type { Status } from './protocol';
import { SAME_CULTURE, compareLabel, presetOptions } from './compare';
import type { CompareState } from './compare';
import { MapView, legendHtml } from './mapView';
import type { Overlay } from './mapView';
import { $, download, esc, pct } from './dom';
import { TABS } from './panels';
import type { Ui } from './panels';

const SAVE_KEY = 'civil.save.v1';
const SPEEDS = [1, 2, 5, 10, 100, 300];
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
  return Math.max(5, Math.min(3000, Math.round(+($('#population') as HTMLInputElement).value) || 1000));
}

function readNpcs(): { npcCount: number; npcPopulation: number } {
  const n = +($('#npc-count') as HTMLInputElement).value;
  const pop = +($('#npc-pop') as HTMLInputElement).value;
  return {
    npcCount: Math.max(0, Math.min(8, Number.isFinite(n) && ($('#npc-count') as HTMLInputElement).value !== '' ? n : DEFAULT_NPC_COUNT)),
    npcPopulation: Math.max(50, Math.min(1500, pop || DEFAULT_NPC_POPULATION)),
  };
}

/** Tell the player up front how the tribe starts. */
function updateBandHint(): void {
  const pop = readPopulation();
  const risk = pop < 30 ? '人数这么少，开局按几户人家生成；一两次意外死亡或连续生男/生女都可能让部落绝嗣，灭绝风险很高。' : '';
  $('#band-hint').textContent = `${pop} 人一开始都住在出生地的同一个营地，靠周围一天能走个来回的土地采集狩猎（平原上约 19 格，一格约能养活 5–10 人）。` +
    `人多到这片土地养不活、或猎物野果被吃薄时，会有人带着家人出去另建营地。${risk}`;
}

($('#seed') as HTMLInputElement).value = randomSeed();
($('#population') as HTMLInputElement).oninput = updateBandHint;
($('#seed') as HTMLInputElement).onchange = regenerate;
$('#reroll').onclick = () => {
  ($('#seed') as HTMLInputElement).value = randomSeed();
  regenerate();
};
$('#best-site').onclick = pickBestSite;
$('#cmp-start').innerHTML += presetOptions(false);
$('#start').onclick = () => {
  const seed = ($('#seed') as HTMLInputElement).value.trim() || randomSeed();
  startGame({ cfg: { seed, culture: readCulture(), startTile, population: readPopulation(), ...readNpcs() } }, ($('#cmp-start') as HTMLSelectElement).value);
};
$('#load-local').onclick = () => {
  const s = localStorage.getItem(SAVE_KEY);
  if (!s) return toast('没有找到存档');
  startGame({ json: s });
};
($('#load-file') as HTMLInputElement).onchange = async (e) => {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0];
  if (!f) return;
  input.value = '';
  startGame({ json: await f.text() });
};
buildDims();
updateBandHint();
regenerate();
window.addEventListener('resize', () => {
  setupView.draw();
  if (game?.ui) game.view.draw(game.ui.world);
});

// ------------------------------------------------------------------- game
// The World lives in a Worker (simWorker.ts); the screen shows a replica refreshed a few times a second.

/** Minimum time between two snapshots while running, ms. */
const SNAPSHOT_MS = 400;
/** Snapshots are spaced so that receiving and drawing them takes at most this share of the main thread. */
const SNAPSHOT_SHARE = 0.12;

interface Game {
  sim: SimClient;
  /** Set once the Worker has built or loaded the world. */
  ui?: Ui;
  view: MapView;
  /** How this world was created; inferred for loaded saves (used to start a comparison run). */
  cfg?: WorldConfig;
  running: boolean;
  speed: number;
  fastForward: boolean;
  modalQueue: GameEvent[];
  cmp?: SimClient;
  cmpStatsAt: number;
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

type Source = { cfg: WorldConfig } | { json: string };

function startGame(src: Source, comparePreset = ''): void {
  endGame();
  $('#setup').classList.add('hidden');
  $('#game').classList.remove('hidden');
  $('#tb-date').textContent = '正在生成世界…';
  $('#tb-era').textContent = '';
  $('#tb-summary').textContent = '';
  $('#tb-rate').textContent = '';
  const sim = new SimClient();
  const view = new MapView($('#map') as HTMLCanvasElement, (t) => {
    const ui = game?.ui;
    if (!ui) return;
    // a settlement's centre opens the settlement; every other tile opens the tile panel
    const s = ui.world.settlements.find((x) => x.alive && x.tile === t.id);
    if (s) ui.select('settlement', s.id);
    else ui.select('tile', t.id);
  });
  const g: Game = {
    sim, view, cfg: 'cfg' in src ? src.cfg : undefined, running: false, speed: 1, fastForward: false, modalQueue: [], cmpStatsAt: 0,
  };
  game = g;
  sim.handlers = {
    onWorld: (w) => {
      if (game !== g) return;
      if (!g.ui) {
        initGame(g, w);
        if (comparePreset) g.ui!.startCompare(comparePreset, {});
      } else {
        g.ui.world = w;
        if (g.modalQueue.length) showModal();
        refresh();
      }
    },
    onStatus: (st) => {
      if (game !== g) return;
      g.cmp?.runTo(st.day);
      if (g.running && !st.pop) setRunning(false); // everyone died
      topbar(st);
    },
    onMajor: (events) => {
      if (game !== g) return;
      g.modalQueue.push(...events);
      setRunning(false);
      showModal();
    },
    onError: (msg) => {
      if (game !== g) return;
      if (g.ui) return toast(`模拟出错：${msg}`);
      toast('存档无法读取');
      returnToSetup();
    },
  };
  if ('cfg' in src) sim.create(src.cfg);
  else sim.load(src.json);
}

function initGame(g: Game, world: World): void {
  g.cfg ??= inferConfig(world);
  const ui: Ui = {
    world,
    tab: 'overview',
    personId: -1,
    settlementId: -1,
    tileId: -1,
    majorOnly: false,
    focus: PLAYER,
    select(kind, id) {
      if (kind === 'person') {
        ui.personId = id;
        switchTab('people');
      } else if (kind === 'tile') {
        ui.tileId = id;
        g.view.selectedTile = id;
        g.view.selectedSettlement = id >= 0 ? ui.world.map.tiles[id].owner : -1;
        switchTab('tile');
      } else {
        ui.settlementId = id;
        g.view.selectedSettlement = id;
        g.view.selectedTile = -1;
        switchTab('settlement');
      }
      refresh();
    },
    toast,
    issue: (cmd) => g.sim.issue(cmd),
    startCompare: (preset, params) => startCompare(g, preset, params),
    stopCompare: () => stopCompare(g),
  };
  g.ui = ui;
  g.view.setMap(world.map);
  $('#map-legend').innerHTML = legendHtml(g.view.overlay);
  document.querySelectorAll<HTMLButtonElement>('#map-tools button').forEach((b) => b.classList.toggle('on', b.dataset.overlay === g.view.overlay));
  $('#speeds').innerHTML = SPEEDS.map((s) => `<button data-speed="${s}">${s}×</button>`).join('');
  buildTabs();
  setRunning(false);
  setSpeed(1);
  refresh();
  // dev hook for inspecting from the console
  if (import.meta.env.DEV) Object.assign(window, { civil: { game: g, refresh } });
}

/** A loaded save doesn't record how it was created; recover it from the founding events (polities that split off later don't count). */
function inferConfig(w: World): WorldConfig {
  const founded = w.events.filter((e) => e.day === 0 && e.title.endsWith('部落诞生')).map((e) => parseInt(e.text, 10));
  return {
    seed: w.seed,
    culture: w.culture,
    startTile: w.settlements[0]?.tile,
    population: founded[0] > 0 ? founded[0] : 1000,
    npcCount: founded.length ? founded.length - 1 : DEFAULT_NPC_COUNT,
    npcPopulation: founded[1] > 0 ? founded[1] : DEFAULT_NPC_POPULATION,
  };
}

function startCompare(g: Game, preset: string, params: Partial<Params>): void {
  const ui = g.ui!;
  stopCompare(g);
  const base = g.cfg!;
  const culture = preset === SAME_CULTURE ? base.culture : PRESETS.find((p) => p.id === preset)?.culture;
  const cmp = new SimClient();
  const state: CompareState = { label: compareLabel(preset, params), status: { day: 0, running: true, rate: 0, pop: 0 } };
  cmp.handlers = {
    onStatus: (st) => {
      state.status = st;
    },
    onError: (msg) => toast(`对比局出错：${msg}`),
  };
  cmp.create({ ...base, culture, params: { ...base.params, ...params } }, true);
  cmp.runTo(g.sim.status.day);
  g.cmp = cmp;
  g.cmpStatsAt = 0;
  ui.compare = state;
  toast(`对比局已开始：${state.label}`);
}

function stopCompare(g: Game): void {
  g.cmp?.terminate();
  g.cmp = undefined;
  if (g.ui) g.ui.compare = undefined;
}

function endGame(): void {
  if (!game) return;
  game.sim.terminate();
  game.cmp?.terminate();
  game = undefined;
  $('#modal').classList.add('hidden');
  delete $('#tab-body').dataset.mounted;
}

function returnToSetup(): void {
  endGame();
  $('#game').classList.add('hidden');
  $('#setup').classList.remove('hidden');
  setupView.draw();
}

function buildTabs(): void {
  $('#tabs').innerHTML = TABS.map((t) => `<button data-tab="${t.id}">${t.name}</button>`).join('');
  switchTab(game!.ui!.tab);
}

function switchTab(id: string): void {
  const ui = game!.ui!;
  const tab = TABS.find((t) => t.id === id) ?? TABS[0];
  const changed = ui.tab !== tab.id || !$('#tab-body').dataset.mounted;
  ui.tab = tab.id;
  document.querySelectorAll<HTMLButtonElement>('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab.id));
  if (changed) {
    const body = $('#tab-body');
    body.dataset.mounted = tab.id;
    body.scrollTop = 0;
    tab.mount(body, ui);
    tab.update(body, ui);
  }
}

/** Date and speed come from the Worker's status; the rest from the replica. */
function topbar(st: Status): void {
  const g = game;
  if (!g?.ui) return;
  const w = g.ui.world;
  const l = personById(w, w.polity.leaderId);
  $('#tb-date').textContent = formatDate(st.day);
  $('#tb-era').textContent = ERAS[w.era];
  $('#tb-summary').innerHTML = `${esc(w.polity.name)} · 人口 ${peopleOf(w, PLAYER).length} · 首领 ${l ? esc(l.name) : '—'} · 合法性 ${pct(w.polity.legitimacy)}`;
  $('#tb-rate').textContent = g.running ? `实际 ${st.rate.toFixed(0)} 天/秒` : '';
}

/** Redraw the map, the open tab and the top bar from the current replica. */
function refresh(): void {
  const g = game;
  const ui = g?.ui;
  if (!g || !ui) return;
  g.view.draw(ui.world);
  const banner = focusBanner(ui);
  $('#focus-banner').innerHTML = banner;
  $('#focus-banner').classList.toggle('hidden', !banner);
  const tab = TABS.find((t) => t.id === ui.tab)!;
  const body = $('#tab-body');
  const top = body.scrollTop;
  tab.update(body, ui);
  body.scrollTop = top;
  topbar(g.sim.status);
}

function sendControl(g: Game): void {
  g.sim.control(g.running, g.speed, g.fastForward);
  // once paused, show exactly the state the Worker stopped at
  if (!g.running) g.sim.requestSnapshot();
}

function setRunning(r: boolean): void {
  const g = game!;
  g.running = r;
  if (!r) g.fastForward = false;
  sendControl(g);
  $('#pause').textContent = r ? '⏸ 暂停' : '▶ 继续';
  $('#ffwd').classList.toggle('on', g.fastForward);
}

function setSpeed(s: number): void {
  const g = game!;
  g.speed = s;
  g.fastForward = false;
  sendControl(g);
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
  const w = g.ui!.world;
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

function loop(): void {
  const t = performance.now();
  const g = game;
  if (!g?.ui) return;
  const every = Math.max(SNAPSHOT_MS, g.sim.snapshotMs / SNAPSHOT_SHARE);
  if (g.running && !g.sim.pending && t - g.sim.requested > every) g.sim.requestSnapshot();
  // the comparison tab polls the other run's yearly statistics
  if (g.cmp && g.ui.tab === 'compare' && t - g.cmpStatsAt > 1000) {
    g.cmpStatsAt = t;
    const cmp = g.cmp;
    void cmp.stats().then((r) => {
      if (game !== g || g.cmp !== cmp || !g.ui?.compare) return;
      g.ui.compare.reply = r;
      if (g.ui.tab === 'compare') refresh();
    });
  }
}
// a timer rather than animation frames, so a hidden page keeps its replica and comparison current
setInterval(loop, 100);

// ------------------------------------------------------------- controls

document.addEventListener('keydown', (e) => {
  if (!game?.ui || e.code !== 'Space') return;
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
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-person],[data-settlement],[data-tile],[data-tab],[data-speed],[data-overlay]');
  const ui = game?.ui;
  if (!el || !game || !ui) return;
  if (el.dataset.unfocus) ui.focus = PLAYER;
  if (el.dataset.person !== undefined) {
    if ($('#modal').contains(el)) {
      game.modalQueue = [];
      showModal();
    }
    ui.select('person', +el.dataset.person);
  } else if (el.dataset.settlement !== undefined) ui.select('settlement', +el.dataset.settlement);
  else if (el.dataset.tile !== undefined) ui.select('tile', +el.dataset.tile);
  else if (el.dataset.tab) {
    switchTab(el.dataset.tab);
    refresh();
  } else if (el.dataset.speed) {
    setSpeed(+el.dataset.speed);
    setRunning(true);
  } else if (el.dataset.overlay) {
    game.view.overlay = el.dataset.overlay as Overlay;
    $('#map-legend').innerHTML = legendHtml(game.view.overlay);
    document.querySelectorAll<HTMLButtonElement>('#map-tools button').forEach((b) => b.classList.toggle('on', b === el));
    refresh();
  }
});

$('#pause').onclick = () => game?.ui && setRunning(!game.running);
$('#ffwd').onclick = () => {
  const g = game;
  if (!g?.ui) return;
  g.fastForward = true;
  g.running = true;
  sendControl(g);
  $('#pause').textContent = '⏸ 暂停';
  $('#ffwd').classList.add('on');
};
$('#save').onclick = async () => {
  const g = game;
  if (!g?.ui) return;
  const json = await g.sim.serialize();
  try {
    localStorage.setItem(SAVE_KEY, json);
    toast('已保存到浏览器');
  } catch {
    toast('浏览器存储空间不足，请使用"导出"');
  }
};
$('#export').onclick = async () => {
  const g = game;
  if (!g?.ui) return;
  const json = await g.sim.serialize();
  download(`civil-${g.ui.world.seed}-${g.sim.status.day}.json`, json);
};
$('#new-game').onclick = () => {
  if (game) returnToSetup();
};
