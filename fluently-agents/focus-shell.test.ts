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
