import { useEffect, useRef } from "react";
import { useSdk, useSettings, type PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { installPaletteSearch } from "./palette";
import { installThreadSearch } from "./threads";
import { searchCache } from "./host";

/** BB versions whose palette and thread search the adapters were checked on. */
const VERIFIED = ["0.47.0", "0.47.1"];

/**
 * While `enabled`, on a verified BB, runs `install`, which adds the disposers
 * of what it installs and gets `invalidate`, which refetches BB's thread
 * searches. Refetches them at once, and again whenever `changes` changes.
 * Returns the anchor of a hidden span to render.
 */
export function useSearchAdapter(
  enabled: boolean,
  install: (disposers: (() => void)[], invalidate: () => Promise<void>) => void,
  changes?: unknown,
) {
  const sdk = useSdk();
  const anchor = useRef<HTMLSpanElement>(null);
  const refresh = useRef(() => {});
  useEffect(() => {
    if (!enabled) return;
    const lifetime = new AbortController();
    const disposers: (() => void)[] = [];
    const stop = () => disposers.splice(0).reverse().forEach((dispose) => dispose());
    void sdk.system
      .version({ signal: lifetime.signal })
      .then((version) => {
        // Native search has no SDK extension point. These adapters are checked
        // against this host version.
        if (lifetime.signal.aborted || version.isDevelopment
          || !VERIFIED.includes(version.currentVersion) || !anchor.current) return;
        const invalidate = searchCache(anchor.current);
        if (!invalidate) return;
        disposers.push(invalidate, () => { refresh.current = () => {}; });
        install(disposers, invalidate);
        refresh.current = invalidate;
        void invalidate();
      })
      .catch(stop);
    return () => {
      lifetime.abort();
      stop();
    };
  }, [sdk, enabled, install]);
  useEffect(() => { refresh.current(); }, [changes]);
  return anchor;
}

function install(disposers: (() => void)[]) {
  disposers.push(installThreadSearch(window));
  disposers.push(installPaletteSearch(document));
}

function UniversalSearch() {
  const { values, isLoading } = useSettings();
  const anchor = useSearchAdapter(!isLoading && values?.universalSearch !== false, install);
  return <span ref={anchor} hidden aria-hidden="true" />;
}

export default function registerUniversalSearch(app: PluginAppBuilder) {
  app.slots.experimental_appOverlay({
    id: "universal-search",
    component: UniversalSearch,
  });
}
