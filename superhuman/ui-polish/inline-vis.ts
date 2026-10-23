// BB draws an inline-vis page in an about:srcdoc frame. BB's iOS app runs BB in
// a react-native-webview, which lets a frame load only http(s) and
// about:blank, so there the frame stays blank. In the app the frame loads
// server.ts's page from this plugin instead, and that page shows BB's.

const FRAMES = "[data-inline-vis-frame] > iframe";
export const READY = "superhuman:inline-vis-ready";
export const PAGE = "superhuman:inline-vis-page";
// Set on the root while the UI Polish setting is off; app.tsx keeps it current.
const OFF = "data-superhuman-ui-polish-off";

/** In BB's iOS app, inline-vis frames load their page through the plugin. */
export function startInlineVis({ pluginId }: { pluginId: string }) {
  if (!iosApp()) return;
  const url = `/api/v1/plugins/${pluginId}/http/inline-vis`;
  // Keyed by frame, not window: moving a frame in the DOM makes a new window.
  const pages = new WeakMap<HTMLIFrameElement, string>();
  const adopt = () => {
    if (document.documentElement.hasAttribute(OFF)) return;
    for (const frame of document.querySelectorAll<HTMLIFrameElement>(
      `${FRAMES}[srcdoc]`,
    )) {
      pages.set(frame, frame.srcdoc);
      frame.removeAttribute("srcdoc");
      frame.src = url;
    }
  };
  // A frame asks again whenever it loads, as BB's would load its page again.
  const answer = (event: MessageEvent) => {
    const source = event.source;
    if (!source || event.data?.type !== READY) return;
    const frames = document.querySelectorAll<HTMLIFrameElement>(FRAMES);
    const frame = [...frames].find((f) => f.contentWindow === source);
    const html = frame && pages.get(frame);
    if (html === undefined) return;
    (source as Window).postMessage({ type: PAGE, html }, "*");
  };
  const observer = new MutationObserver(adopt);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["srcdoc", OFF],
  });
  window.addEventListener("message", answer);
  adopt();
  return () => {
    observer.disconnect();
    window.removeEventListener("message", answer);
  };
}

/** BB's iOS app: react-native-webview's message handler in a WKWebView. */
function iosApp() {
  // WebKit hides handler names from `in` and Object.keys, so read the handler.
  const page = window as {
    webkit?: { messageHandlers?: { ReactNativeWebView?: unknown } };
  };
  return page.webkit?.messageHandlers?.ReactNativeWebView !== undefined;
}
