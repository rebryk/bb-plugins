import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { PAGE, READY } from "./inline-vis";

// The page an inline-vis frame loads in BB's iOS app (see inline-vis.ts): it
// asks the BB page for the page BB would have put in the frame and shows it.
// Like BB's frame, it runs sandboxed, apart from BB's origin.
const FRAME_PAGE = `<!doctype html><meta charset="utf-8"><script>addEventListener("message",function show(e){var d=e.data;if(e.source!==parent||!d||d.type!==${JSON.stringify(PAGE)}||typeof d.html!=="string")return;removeEventListener("message",show);document.open();document.write(d.html);document.close()});parent.postMessage({type:${JSON.stringify(READY)}},"*")</script>`;

export default function registerUiPolishServer(bb: BbPluginApi) {
  bb.http.route(
    "GET",
    "/inline-vis",
    () =>
      new Response(FRAME_PAGE, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy":
            "sandbox allow-scripts allow-forms; frame-ancestors 'self'",
          "x-content-type-options": "nosniff",
          "cache-control": "no-cache",
        },
      }),
  );
}
