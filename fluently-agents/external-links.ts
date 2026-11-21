import type { MouseEvent } from 'react';

// The pinned SDK has no per-ThreadChat URL policy. Capture only ordinary
// external web anchor activation before the native renderer applies host policy.
// Keep the real anchors, host renderers, internal routes and file handlers.
export function openExternalWebLink(event: MouseEvent<HTMLElement>) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey
    || event.ctrlKey || event.shiftKey || event.altKey) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const anchor = target.closest('a[href]');
  if (!(anchor instanceof HTMLAnchorElement)
    || !event.currentTarget.contains(anchor) || anchor.hasAttribute('download')) return;
  const href = anchor.getAttribute('href');
  // Relative URLs belong to BB (including attachment and workspace previews).
  if (!href || !/^(https?:\/\/|\/\/)/i.test(href)) return;
  if (anchor.target && anchor.target !== '_blank' && anchor.target !== '_self') return;
  let url: URL;
  try { url = new URL(href, anchor.ownerDocument.baseURI); } catch { return; }
  if (!['http:', 'https:'].includes(url.protocol)
    || url.origin === anchor.ownerDocument.location.origin) return;
  event.preventDefault();
  event.stopPropagation();
  // No BB auth, application context or referrer is forwarded. Native clients
  // own handling of window.open; web clients use a separate browser tab.
  anchor.ownerDocument.defaultView?.open(url.href, '_blank', 'noopener,noreferrer');
}
