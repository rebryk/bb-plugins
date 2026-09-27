// Appended to BB's viewport: a key's last value wins.
const LIMITS = "maximum-scale=1, user-scalable=no";
const GESTURES = ["gesturestart", "gesturechange"];

/** Holds the page at 100% until the returned function runs. */
export function lockZoom(doc: Document): () => void {
  // BB's mobile app and an installed web app honor the viewport's limits,
  // which also keep a text field with small type from zooming in on focus.
  const meta = doc.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  const original = meta?.content ?? "";
  const locked = original ? `${original}, ${LIMITS}` : LIMITS;
  if (meta) meta.content = locked;

  // A Safari tab has ignored the limits since iOS 10, but a pinch whose
  // gesture events are canceled still doesn't zoom.
  const cancel = (event: Event) => event.preventDefault();
  for (const type of GESTURES) doc.addEventListener(type, cancel, { passive: false });

  // A double tap has no event to cancel.
  const roots = [doc.documentElement, doc.body];
  const actions = roots.map((root) => root.style.touchAction);
  for (const root of roots) root.style.touchAction = "manipulation";

  return () => {
    if (meta?.content === locked) meta.content = original;
    for (const type of GESTURES) doc.removeEventListener(type, cancel);
    roots.forEach((root, index) => {
      root.style.touchAction = actions[index];
    });
  };
}
