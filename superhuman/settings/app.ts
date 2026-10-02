import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";

export default function registerSettings(app: PluginAppBuilder) {
  app.contentScripts.register({
    id: "settings-sections",
    mount() {
      // Keep BB's fields and autosave; only label the final two options.
      const heading = document.createElement("h2");
      heading.textContent = "Experimental";
      heading.className = "text-sm font-medium text-foreground";
      heading.style.cssText = "margin-top:24px;padding-top:24px;border-top:1px solid var(--border)";
      const place = () => {
        const row = document.querySelector(
          '[data-testid="plugin-detail-superhuman"] [role="switch"][aria-label="Thread ETA"]',
        )?.closest("[data-control-placement]");
        if (!row) heading.remove();
        else if (heading.nextElementSibling !== row) row.before(heading);
      };
      const observer = new MutationObserver(place);
      observer.observe(document.body, { childList: true, subtree: true });
      place();
      return () => { observer.disconnect(); heading.remove(); };
    },
  });
}
