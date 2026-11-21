// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { mountFocusedShell } from './focus-shell';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.innerHTML = ''; });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture() {
  document.body.innerHTML = `<div data-testid="app-layout-root">
    <div data-side="left" data-state="expanded"></div>
    <main data-sidebar="inset"><div data-panel-group>
      <div data-panel style="flex: 60 1 0px"><div data-split-pane-id="one">
        <div><header></header><div data-pane-content><div data-bb-plugin="fluently-agents"><div class="fa-app"></div></div></div></div>
      </div></div><div data-panel data-testid="right-panel">Keep this terminal</div>
    </div></main></div>`;
  dispose = mountFocusedShell();
}
it('decorates the single Agents shell without changing layout state or panel content', () => {
  fixture();
  expect(document.querySelector('[data-testid="app-layout-root"]')?.getAttribute('data-fa-focused-shell')).toBe('shell');
  expect(document.querySelector('[data-state]')?.getAttribute('data-state')).toBe('expanded');
  expect(document.querySelector('[data-panel]')?.getAttribute('style')).toBe('flex: 60 1 0px');
  expect(document.querySelector('[data-testid="right-panel"]')?.textContent).toBe('Keep this terminal');
});
it('restores shell decoration when leaving Agents and on plugin disposal', async () => {
  fixture();
  document.querySelector('.fa-app')?.remove();
  await tick();
  expect(document.querySelectorAll('[data-fa-focused-shell]')).toHaveLength(0);
  dispose?.();
  expect(Array.from(document.querySelectorAll('style')).some(style => style.textContent?.includes('data-fa-focused-shell'))).toBe(false);
});
it('keeps host navigation available for other split panes', async () => {
  fixture();
  const other = document.createElement('div'); other.setAttribute('data-split-pane-id', 'two');
  document.querySelector('[data-testid="app-layout-root"]')!.append(other);
  await tick();
  expect(document.querySelectorAll('[data-fa-focused-shell]')).toHaveLength(0);
  other.remove(); await tick();
  expect(document.querySelector('[data-testid="app-layout-root"]')?.getAttribute('data-fa-focused-shell')).toBe('shell');
});
it('supports the compact host without split or pane-content attributes', () => {
  fixture(); dispose?.();
  document.querySelector('[data-split-pane-id]')?.removeAttribute('data-split-pane-id');
  document.querySelector('[data-pane-content]')?.removeAttribute('data-pane-content');
  const shelf = document.createElement('div'); shelf.setAttribute('data-testid', 'secondary-panel-shelf'); document.body.append(shelf);
  dispose = mountFocusedShell();
  expect(document.querySelector('[data-testid="app-layout-root"]')?.getAttribute('data-fa-focused-shell')).toBe('shell');
  expect(shelf.getAttribute('data-fa-focused-shell')).toBe('hidden');
});

it('restores native padding, edge, and drag geometry on split and exit', async () => {
  fixture(); dispose?.();
  const shell = document.querySelector<HTMLElement>('[data-testid="app-layout-root"]')!;
  const inset = shell.querySelector<HTMLElement>('main[data-sidebar="inset"]')!;
  shell.setAttribute('data-framed', '');
  // Native framing uses padding and a separate overlay, not a main border.
  const hostStyle = document.createElement('style');
  hostStyle.textContent = `
    [data-framed] { padding: 8px; --bb-window-frame-lip: 8px; }
    main[data-sidebar="inset"] { padding: 0 1px 1px; }
    [data-sidebar="inset-edge"] { display: block; border: 1px solid; }
    [data-testid="window-title-bar-drag-region"] { height: 8px; }
  `;
  document.head.append(hostStyle);
  const edge = document.createElement('span');
  edge.setAttribute('data-sidebar', 'inset-edge'); inset.append(edge);
  const drag = document.createElement('div');
  drag.dataset.testid = 'window-title-bar-drag-region'; shell.prepend(drag);
  const controls = document.createElement('div');
  controls.dataset.testid = 'app-window-title-bar'; shell.prepend(controls);
  const original = shell.getAttribute('style');
  try {
    expect(getComputedStyle(shell).padding).toBe('8px');
    dispose = mountFocusedShell();
    expect(getComputedStyle(shell).padding).toBe('0px');
    expect(getComputedStyle(inset).padding).toBe('0px');
    expect(getComputedStyle(edge).display).toBe('none');
    expect(getComputedStyle(drag).height).toBe('12px');
    expect(getComputedStyle(controls).display).not.toBe('none');
    expect(shell.getAttribute('style')).toBe(original);
    const other = document.createElement('div');
    other.dataset.splitPaneId = 'two'; shell.append(other); await tick();
    expect(getComputedStyle(shell).padding).toBe('8px');
    expect(getComputedStyle(edge).display).toBe('block');
    other.remove(); await tick();
    expect(getComputedStyle(edge).display).toBe('none');
    document.querySelector('.fa-app')!.remove(); await tick();
    expect(getComputedStyle(shell).padding).toBe('8px');
    expect(getComputedStyle(inset).padding).toBe('0px 1px 1px');
    expect(getComputedStyle(edge).display).toBe('block');
    expect(getComputedStyle(drag).height).toBe('8px');
  } finally { hostStyle.remove(); }
});

it('keeps hidden-titlebar navigation aligned and reserves visible native controls', () => {
  fixture();
  const shell = document.querySelector('[data-testid="app-layout-root"]')!;
  shell.setAttribute('data-framed', '');
  const bar = document.createElement('nav'); bar.className = 'fa-topbar';
  document.querySelector('.fa-app')!.append(bar);
  const base = document.createElement('style');
  base.textContent = '.fa-app .fa-topbar { left: 12px; }';
  document.head.prepend(base);
  try {
    document.documentElement.setAttribute('data-superhuman-no-title-bar', '');
    expect(getComputedStyle(bar).left).toBe('12px');
    document.documentElement.removeAttribute('data-superhuman-no-title-bar');
    // jsdom does not resolve max()/var(); verify the gate here and geometry in Yab.
    const rule = Array.from(document.styleSheets).flatMap(sheet => Array.from(sheet.cssRules))
      .find(rule => rule.cssText.includes('--bb-window-title-bar-controls-end')) as CSSStyleRule;
    expect(bar.matches(rule.selectorText)).toBe(true);
    document.documentElement.setAttribute('data-superhuman-no-title-bar', '');
    expect(bar.matches(rule.selectorText)).toBe(false);
  } finally {
    base.remove(); document.documentElement.removeAttribute('data-superhuman-no-title-bar');
  }
});
