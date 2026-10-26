export function $(sel: string, root: ParentNode = document): HTMLElement {
  const el = root.querySelector(sel);
  if (!el) throw new Error(`missing element ${sel}`);
  return el as HTMLElement;
}

export function esc(s: string | number): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function pct(x: number, digits = 0): string {
  return `${(x * 100).toFixed(digits)}%`;
}

/** Horizontal bar 0..1 with a label. */
export function bar(label: string, v: number, color = 'var(--accent)', text?: string): string {
  const w = Math.max(0, Math.min(1, v)) * 100;
  return `<div class="bar"><span class="bar-label">${esc(label)}</span><span class="bar-track"><span class="bar-fill" style="width:${w.toFixed(1)}%;background:${color}"></span></span><span class="bar-val">${esc(text ?? pct(v))}</span></div>`;
}

/** Compact bar without a label column. */
export function mini(v: number, color = 'var(--accent)', text?: string): string {
  const w = Math.max(0, Math.min(1, v)) * 100;
  return `<span class="mini"><span class="bar-track"><span class="bar-fill" style="width:${w.toFixed(1)}%;background:${color}"></span></span><span class="bar-val">${esc(text ?? pct(v))}</span></span>`;
}

export function h(tag: string, attrs: Record<string, string> = {}, html = ''): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.innerHTML = html;
  return el;
}

export function download(name: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
