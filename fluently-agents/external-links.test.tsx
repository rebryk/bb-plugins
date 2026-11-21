// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { openExternalWebLink } from './external-links';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function mount(href: string, props = {}) {
  const host = vi.fn((event: import('react').MouseEvent) => event.preventDefault());
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  const view = render(<div onClickCapture={openExternalWebLink}><a href={href} onClick={host} {...props}><span>Link</span></a></div>);
  return { host, open, link: view.getByText('Link') };
}
it.each(['https://example.com/report?q=1#section', 'http://example.com/', '//example.com/report'])('opens only the clicked web URL once: %s', href => {
  const { link, host, open } = mount(href);
  fireEvent.click(link, { detail: 0 });
  expect(open).toHaveBeenCalledExactlyOnceWith(new URL(href, document.baseURI).href, '_blank', 'noopener,noreferrer');
  expect(host).not.toHaveBeenCalled();
});
it.each(['/projects/p/threads/t', `${window.location.origin}/projects/p/threads/t`, '/api/attachments/a', '/workspace/file.txt', '#section', 'file:///tmp/a', 'bb://thread/t', 'javascript:void(0)', 'mailto:a@example.com'])('retains host handler: %s', href => {
  const { link, host, open } = mount(href); fireEvent.click(link);
  expect(open).not.toHaveBeenCalled(); expect(host).toHaveBeenCalledOnce();
});
it.each([{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }])('retains modified/middle click %j', options => {
  const { link, host, open } = mount('https://example.com'); fireEvent.click(link, options);
  expect(open).not.toHaveBeenCalled(); expect(host).toHaveBeenCalledOnce();
});
it.each([{ download: 'report' }, { target: 'report-window' }])('retains explicit anchor behavior %j', props => {
  const { link, host, open } = mount('https://example.com', props); fireEvent.click(link);
  expect(open).not.toHaveBeenCalled(); expect(host).toHaveBeenCalledOnce();
});
it('respects already prevented activation', () => {
  const open = vi.spyOn(window, 'open');
  const view = render(<div onClickCapture={e => e.preventDefault()}><div onClickCapture={openExternalWebLink}><a href="https://example.com">Prevented</a></div></div>);
  fireEvent.click(view.getByText('Prevented')); expect(open).not.toHaveBeenCalled();
});
