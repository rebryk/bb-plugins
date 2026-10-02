import { useEffect, useRef } from "react";
import { useSdk, useSettings, type PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { installPaletteSearch } from "./palette";
import { installThreadSearch } from "./threads";
import { searchCache } from "./host";

function UniversalSearch() {
  const sdk = useSdk();
  const { values, isLoading } = useSettings();
  const anchor = useRef<HTMLSpanElement>(null);
  const enabled = !isLoading && values?.universalSearch !== false;
  useEffect(() => {
    if (!enabled) return;
    const lifetime = new AbortController();
    const disposers: (() => void)[] = [];
    const stop = () => disposers.splice(0).reverse().forEach((dispose) => dispose());
    void sdk.system
      .version({ signal: lifetime.signal })
      .then((version) => {
        // Native search has no SDK extension point. These adapters are checked
        // against this host version; plugin-owned Snooze needs neither adapter.
        if (lifetime.signal.aborted || version.isDevelopment
          || version.currentVersion !== "0.44.0" || !anchor.current) return;
        const invalidate = searchCache(anchor.current);
        if (!invalidate) return;
        disposers.push(invalidate);
        disposers.push(installThreadSearch(window));
        disposers.push(installPaletteSearch(document));
        invalidate();
      })
      .catch(stop);
    return () => {
      lifetime.abort();
      stop();
    };
  }, [sdk, enabled]);
  return <span ref={anchor} hidden aria-hidden="true" />;
}

export default function registerUniversalSearch(app: PluginAppBuilder) {
  app.slots.experimental_appOverlay({
    id: "universal-search",
    component: UniversalSearch,
  });
}
