// Encyclopedia overlay. Opened by any element with data-wiki ("" = index, or an entry id).

import { $, esc } from './dom';
import { WIKI } from './wiki';

const CATEGORY_ORDER = ['入门', '地图', '人口与社会', '经济', '劳动', '政治', '文化', '科技', '外交与战争'];

let current = '';
let query = '';

function categories(): string[] {
  const cats = [...new Set(WIKI.map((e) => e.category))];
  const rank = (c: string) => (CATEGORY_ORDER.indexOf(c) + 1 || 99);
  return cats.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, 'zh'));
}

function matches(q: string) {
  const s = q.trim().toLowerCase();
  return s ? WIKI.filter((e) => (e.title + e.body.replace(/<[^>]+>/g, '')).toLowerCase().includes(s)) : WIKI;
}

function render(): void {
  const list = matches(query);
  const first = categories().flatMap((c) => list.filter((e) => e.category === c))[0];
  const entry = WIKI.find((e) => e.id === current) ?? first;
  if (entry) current = entry.id;
  const nav = categories()
    .map((c) => {
      const items = list.filter((e) => e.category === c);
      if (!items.length) return '';
      return `<h4>${esc(c)}</h4>${items
        .map((e) => `<a data-wiki="${esc(e.id)}" class="${e.id === current ? 'on' : ''}">${esc(e.title)}</a>`)
        .join('')}`;
    })
    .join('');
  $('#wiki-nav').innerHTML = nav || '<p class="muted small">没有找到相关条目</p>';
  $('#wiki-body').innerHTML = entry
    ? `<div class="muted small">${esc(entry.category)}</div><h2>${esc(entry.title)}</h2>${entry.body}`
    : '';
}

export function openWiki(id = ''): void {
  if (id) current = id;
  $('#wiki').classList.remove('hidden');
  render();
}

export function closeWiki(): void {
  $('#wiki').classList.add('hidden');
}

const root = document.createElement('div');
root.id = 'wiki';
root.className = 'hidden';
root.innerHTML = `<div class="wiki-box">
  <div class="wiki-head"><strong>百科</strong><input id="wiki-search" type="search" placeholder="搜索…" /><button id="wiki-close" class="ghost">关闭</button></div>
  <div class="wiki-main"><nav id="wiki-nav"></nav><article id="wiki-body"></article></div>
</div>`;
document.body.appendChild(root);

$('#wiki-close').onclick = closeWiki;
root.addEventListener('click', (e) => {
  if (e.target === root) closeWiki();
});
($('#wiki-search') as HTMLInputElement).oninput = (e) => {
  query = (e.target as HTMLInputElement).value;
  render();
};
document.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-wiki]');
  if (el) openWiki(el.dataset.wiki);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !root.classList.contains('hidden')) closeWiki();
});
